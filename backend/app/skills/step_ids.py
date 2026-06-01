from __future__ import annotations

from typing import Any

from app.skills.skill_schema import SkillCard


def skill_card_with_unique_step_ids(card: SkillCard) -> tuple[SkillCard, list[str]]:
    content = card.model_dump(mode="json")
    steps, warnings = ensure_unique_step_ids(content.get("steps", []))
    content["steps"] = steps
    return SkillCard.model_validate(content), warnings


def ensure_unique_step_ids(steps: list[Any]) -> tuple[list[dict[str, Any]], list[str]]:
    used: set[str] = set()
    normalized_steps: list[dict[str, Any]] = []
    warnings: list[str] = []
    for index, raw_step in enumerate(steps):
        if not isinstance(raw_step, dict):
            continue
        step = dict(raw_step)
        original = str(step.get("step_id") or "").strip()
        base = original or f"step_{index + 1}"
        candidate = base
        suffix = 2
        while candidate in used:
            candidate = f"{base}_{suffix}"
            suffix += 1
        if candidate != original:
            if original:
                warnings.append(
                    f"步骤 {index + 1} 的 step_id 从 `{original}` 自动修正为 `{candidate}`，避免重复。"
                )
            else:
                warnings.append(f"步骤 {index + 1} 的 step_id 为空，已自动修正为 `{candidate}`。")
            step["step_id"] = candidate
        else:
            step["step_id"] = original
        used.add(candidate)
        normalized_steps.append(step)
    return normalized_steps, warnings
