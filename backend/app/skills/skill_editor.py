from __future__ import annotations

import json
from pathlib import Path
from time import sleep
from typing import Any, Iterator

from app.db.models import ModelConfig
from app.llm import LLMClient, LLMError
from app.skills.skill_schema import SkillCard, SkillRewriteRequest, SkillRewriteResponse


PROMPT_PATH = Path(__file__).resolve().parents[1] / "llm" / "prompts" / "skill_editor_prompt.md"
STREAM_INTERVAL_SECONDS = 0.035
BASIC_FIELDS = {
    "name",
    "version",
    "business_domain",
    "description",
    "trigger_intents",
    "user_utterance_examples",
    "goal",
    "required_info",
    "slot_filling_policy",
    "interruption_policy",
    "response_rules",
}
STEP_FIELDS = {"name", "instruction", "expected_user_info", "allowed_actions"}


class SkillEditor:
    def rewrite(self, request: SkillRewriteRequest, model_config: ModelConfig) -> SkillRewriteResponse:
        raw = LLMClient(model_config).generate_json(PROMPT_PATH.read_text(encoding="utf-8"), self._payload(request))
        return self._normalize_response(raw, request)

    def stream_text(
        self, request: SkillRewriteRequest, model_config: ModelConfig
    ) -> Iterator[dict[str, object]]:
        chunks: list[str] = []
        try:
            for chunk in LLMClient(model_config).generate_text_stream(
                PROMPT_PATH.read_text(encoding="utf-8"), self._payload(request)
            ):
                chunks.append(chunk)
                yield {"event": "status", "data": {"text": "正在改写选中部分"}}
            raw = json.loads(_extract_json("".join(chunks)))
            response = self._normalize_response(raw, request)
        except (LLMError, json.JSONDecodeError, ValueError) as exc:
            response = SkillRewriteResponse(
                draft_skill=request.current_skill,
                assistant_message="改写失败，已保留当前技能内容。",
                changed_paths=[],
                warnings=[f"模型未能完成局部改写：{exc}"],
            )
        for chunk in _chunk_text(response.assistant_message):
            yield {"event": "message_chunk", "data": {"content": chunk}}
            sleep(STREAM_INTERVAL_SECONDS)
        yield {"event": "complete", "data": response.model_dump(mode="json")}

    def _payload(self, request: SkillRewriteRequest) -> dict[str, Any]:
        return {
            "current_skill": request.current_skill.model_dump(mode="json"),
            "instruction": request.instruction,
            "target_path": request.target_path,
            "target_label": request.target_label,
            "conversation": request.conversation[-12:],
        }

    def _normalize_response(
        self, raw: dict[str, Any], request: SkillRewriteRequest
    ) -> SkillRewriteResponse:
        draft = raw.get("draft_skill") if isinstance(raw.get("draft_skill"), dict) else raw
        candidate = SkillCard.model_validate(draft)
        merged = _merge_target(request.current_skill, candidate, request.target_path)
        assistant_message = str(raw.get("assistant_message") or "已完成选中部分的改写。").strip()
        warnings = [str(item) for item in raw.get("warnings", []) if str(item).strip()]
        changed_paths = [str(item) for item in raw.get("changed_paths", []) if str(item).strip()]
        if not changed_paths and merged.model_dump() != request.current_skill.model_dump():
            changed_paths = [request.target_path]
        return SkillRewriteResponse(
            draft_skill=merged,
            assistant_message=assistant_message,
            changed_paths=changed_paths,
            warnings=warnings,
        )


def _merge_target(current: SkillCard, candidate: SkillCard, target_path: str) -> SkillCard:
    normalized_path = target_path.strip() or "all"
    if normalized_path == "all":
        return candidate

    current_data = current.model_dump(mode="json")
    candidate_data = candidate.model_dump(mode="json")
    if normalized_path == "basic":
        for field in BASIC_FIELDS:
            if field in candidate_data:
                current_data[field] = candidate_data[field]
        return SkillCard.model_validate(current_data)

    if normalized_path.startswith("steps."):
        step_id = normalized_path.split(".", 1)[1]
        current_steps = [step for step in current_data.get("steps", []) if isinstance(step, dict)]
        candidate_steps = [step for step in candidate_data.get("steps", []) if isinstance(step, dict)]
        target_index = next(
            (index for index, step in enumerate(current_steps) if step.get("step_id") == step_id),
            -1,
        )
        if target_index < 0:
            return current
        replacement = next(
            (step for step in candidate_steps if step.get("step_id") == step_id),
            candidate_steps[target_index] if target_index < len(candidate_steps) else None,
        )
        if not isinstance(replacement, dict):
            return current
        next_step = dict(current_steps[target_index])
        for field in STEP_FIELDS:
            if field in replacement:
                next_step[field] = replacement[field]
        current_steps[target_index] = next_step
        current_data["steps"] = current_steps
        return SkillCard.model_validate(current_data)

    return current


def _extract_json(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`").strip()
        if stripped.startswith("json"):
            stripped = stripped[4:].strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end >= start:
        return stripped[start : end + 1]
    return stripped


def _chunk_text(text: str, size: int = 12) -> Iterator[str]:
    for index in range(0, len(text), size):
        yield text[index : index + size]
