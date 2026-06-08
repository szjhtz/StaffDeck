from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from tempfile import mkdtemp
from typing import Any

from app.db.models import GeneralSkill, ModelConfig, new_id
from app.general_skills.schema import (
    GeneralSkillExecutionPlan,
    GeneralSkillReply,
    GeneralSkillRunResponse,
    GeneralSkillSelection,
)
from app.llm import LLMClient, LLMError


PROMPT_DIR = Path(__file__).resolve().parents[1] / "llm" / "prompts"
SELECTOR_PROMPT = PROMPT_DIR / "general_skill_selector_prompt.md"
RUNNER_PROMPT = PROMPT_DIR / "general_skill_runner_prompt.md"
REPLY_PROMPT = PROMPT_DIR / "general_skill_reply_prompt.md"
RUN_TIMEOUT_SECONDS = 12
MAX_OUTPUT_CHARS = 20000


class GeneralSkillSelector:
    def decide(
        self,
        query: str,
        general_skills: list[GeneralSkill],
        model_config: ModelConfig,
    ) -> GeneralSkillSelection:
        if not general_skills:
            return GeneralSkillSelection(use_general_skill=False, reason="No general skills are available")
        payload = {
            "user_message": query,
            "general_skills": [
                {
                    "slug": skill.slug,
                    "name": skill.name,
                    "description": skill.description,
                    "homepage": skill.homepage,
                    "status": skill.status,
                }
                for skill in general_skills
                if skill.status == "published"
            ],
        }
        if not payload["general_skills"]:
            return GeneralSkillSelection(use_general_skill=False, reason="No published general skills are available")
        raw = LLMClient(model_config).generate_json(SELECTOR_PROMPT.read_text(encoding="utf-8"), payload)
        decision = GeneralSkillSelection.model_validate(raw)
        slugs = {skill.slug for skill in general_skills if skill.status == "published"}
        if not decision.use_general_skill or not decision.selected_slug or decision.selected_slug not in slugs:
            return GeneralSkillSelection(
                use_general_skill=False,
                selected_slug=None,
                confidence=decision.confidence,
                reason=decision.reason or "The model did not select a published general skill",
            )
        return decision


class GeneralSkillRunner:
    def run(
        self,
        skill: GeneralSkill,
        query: str,
        model_config: ModelConfig,
        user_id: str = "",
    ) -> GeneralSkillRunResponse:
        trace: list[dict[str, Any]] = []
        trace.append({"phase": "skill_loaded", "message": f"已加载通用技能 {skill.name}", "slug": skill.slug})
        plan = self._generate_plan(skill, query, model_config, trace)
        stdout, stderr, structured_result = self._execute_plan(skill, query, plan, user_id, trace)
        reply = self._generate_reply(skill, query, model_config, trace, stdout, stderr, structured_result)
        return GeneralSkillRunResponse(
            skill_slug=skill.slug,
            execution_trace=trace,
            stdout=stdout,
            stderr=stderr,
            structured_result=structured_result,
            reply=reply,
        )

    def _generate_plan(
        self,
        skill: GeneralSkill,
        query: str,
        model_config: ModelConfig,
        trace: list[dict[str, Any]],
    ) -> GeneralSkillExecutionPlan:
        trace.append({"phase": "planning", "message": "正在根据 SKILL.md 生成 Python runner"})
        payload = {
            "query": query,
            "skill": {
                "slug": skill.slug,
                "name": skill.name,
                "description": skill.description,
                "homepage": skill.homepage,
                "markdown": skill.skill_markdown,
            },
            "runtime": {
                "language": "python",
                "stdin_json": {"query": query, "skill_slug": skill.slug, "skill_name": skill.name},
                "timeout_seconds": RUN_TIMEOUT_SECONDS,
            },
        }
        raw = LLMClient(model_config).generate_json(RUNNER_PROMPT.read_text(encoding="utf-8"), payload)
        plan = GeneralSkillExecutionPlan.model_validate(raw)
        if not plan.code.strip():
            raise LLMError("General skill runner code is empty")
        trace.append(
            {
                "phase": "plan_created",
                "message": "已生成 Python runner",
                "rationale": plan.rationale,
            }
        )
        return plan

    def _execute_plan(
        self,
        skill: GeneralSkill,
        query: str,
        plan: GeneralSkillExecutionPlan,
        user_id: str,
        trace: list[dict[str, Any]],
    ) -> tuple[str, str, dict[str, Any]]:
        run_dir = Path(mkdtemp(prefix="ultrarag_general_skill_"))
        runner_path = run_dir / "runner.py"
        runner_path.write_text(plan.code, encoding="utf-8")
        stdin_payload = {
            "query": query,
            "skill_slug": skill.slug,
            "skill_name": skill.name,
            "user_id": user_id,
        }
        trace.append({"phase": "running_code", "message": "正在运行 Python runner", "run_id": run_dir.name})
        try:
            completed = subprocess.run(
                [sys.executable, str(runner_path)],
                input=json.dumps(stdin_payload, ensure_ascii=False),
                text=True,
                capture_output=True,
                cwd=str(run_dir),
                timeout=RUN_TIMEOUT_SECONDS,
                check=False,
            )
            stdout = _truncate(completed.stdout)
            stderr = _truncate(completed.stderr)
            structured = _parse_stdout_json(stdout)
            if completed.returncode != 0:
                structured.setdefault("success", False)
                structured.setdefault("error", f"runner exited with code {completed.returncode}")
            trace.append(
                {
                    "phase": "code_finished",
                    "message": "Python runner 执行完成",
                    "return_code": completed.returncode,
                    "stdout_preview": stdout[:600],
                    "stderr_preview": stderr[:600],
                }
            )
            return stdout, stderr, structured
        except subprocess.TimeoutExpired as exc:
            stdout = _truncate(exc.stdout if isinstance(exc.stdout, str) else "")
            stderr = _truncate(exc.stderr if isinstance(exc.stderr, str) else "")
            structured = {"success": False, "error": "runner_timeout", "message": "通用技能运行超时"}
            trace.append({"phase": "code_timeout", "message": "Python runner 执行超时"})
            return stdout, stderr, structured

    def _generate_reply(
        self,
        skill: GeneralSkill,
        query: str,
        model_config: ModelConfig,
        trace: list[dict[str, Any]],
        stdout: str,
        stderr: str,
        structured_result: dict[str, Any],
    ) -> str:
        trace.append({"phase": "replying", "message": "正在根据运行结果生成回复"})
        payload = {
            "query": query,
            "skill": {
                "slug": skill.slug,
                "name": skill.name,
                "description": skill.description,
            },
            "execution_trace": trace,
            "stdout": stdout,
            "stderr": stderr,
            "structured_result": structured_result,
        }
        try:
            raw = LLMClient(model_config).generate_json(REPLY_PROMPT.read_text(encoding="utf-8"), payload)
            reply = GeneralSkillReply.model_validate(raw).reply.strip()
        except LLMError:
            raise
        except Exception as exc:
            raise LLMError(f"General skill reply returned invalid JSON schema: {exc}") from exc
        if not reply:
            raise LLMError("General skill reply is empty")
        trace.append({"phase": "reply_created", "message": "已生成最终回复"})
        return reply


def _truncate(value: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "\n...<truncated>"


def _parse_stdout_json(stdout: str) -> dict[str, Any]:
    stripped = stdout.strip()
    if not stripped:
        return {"success": False, "message": "runner produced no stdout"}
    try:
        value = json.loads(stripped)
        if isinstance(value, dict):
            return value
        return {"success": True, "data": value}
    except json.JSONDecodeError:
        return {"success": True, "text": stripped}
