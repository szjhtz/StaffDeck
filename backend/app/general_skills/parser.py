from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ParsedGeneralSkill:
    name: str
    slug: str
    description: str | None
    homepage: str | None
    markdown: str


def parse_skill_markdown(markdown: str) -> ParsedGeneralSkill:
    text = markdown.strip()
    if not text:
        raise ValueError("SKILL.md cannot be empty")
    frontmatter, _body = _split_frontmatter(text)
    name = _metadata_value(frontmatter, "name")
    slug = _metadata_value(frontmatter, "slug")
    description = _metadata_value(frontmatter, "description") or None
    homepage = _metadata_value(frontmatter, "homepage") or None
    if not name:
        raise ValueError("SKILL.md frontmatter must include name")
    if not slug:
        slug = _slugify(name)
    return ParsedGeneralSkill(
        name=name,
        slug=slug,
        description=description,
        homepage=homepage,
        markdown=text,
    )


def _split_frontmatter(text: str) -> tuple[str, str]:
    if not text.startswith("---"):
        return "", text
    lines = text.splitlines()
    end_index = -1
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            end_index = index
            break
    if end_index < 0:
        return "", text
    return "\n".join(lines[1:end_index]), "\n".join(lines[end_index + 1 :])


def _metadata_value(frontmatter: str, key: str) -> str:
    if not frontmatter:
        return ""
    pattern = re.compile(rf"^\s*{re.escape(key)}\s*:\s*(.+?)\s*$", re.MULTILINE)
    match = pattern.search(frontmatter)
    if not match:
        return ""
    value = match.group(1).strip()
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        value = value[1:-1].strip()
    return value


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return slug or "general-skill"
