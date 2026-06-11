from __future__ import annotations

import json
import queue
import re
import threading
from collections.abc import Iterator
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.db import get_session
from app.db.models import GeneralSkill, ModelConfig, utc_now
from app.general_skills import GeneralSkillImportRequest, GeneralSkillRead, GeneralSkillRunRequest, GeneralSkillRunResponse
from app.general_skills.schema import GeneralSkillFile
from app.general_skills.runner import GeneralSkillRunner
from app.security.tenant import ensure_tenant

router = APIRouter(prefix="/api/enterprise/general-skills", tags=["enterprise:general-skills"])


def general_skill_read(row: GeneralSkill) -> GeneralSkillRead:
    return GeneralSkillRead(
        id=row.id,
        tenant_id=row.tenant_id,
        slug=row.slug,
        name=row.name,
        description=row.description,
        homepage=row.homepage,
        skill_markdown=row.skill_markdown,
        skill_files=[GeneralSkillFile.model_validate(item) for item in _skill_files_or_markdown(row)],
        metadata=row.metadata_json or {},
        status=row.status,
        permissions=row.permissions_json or {},
        runtime_config=row.runtime_config_json or {},
        created_at=row.created_at.isoformat(),
        updated_at=row.updated_at.isoformat(),
    )


@router.post("/import", response_model=GeneralSkillRead)
def import_general_skill(
    request: GeneralSkillImportRequest,
    db: Session = Depends(get_session),
) -> GeneralSkillRead:
    ensure_tenant(db, request.tenant_id)
    files = _normalize_skill_files(request.files, request.markdown)
    markdown = _skill_markdown_from_files(files)
    metadata = _parse_skill_metadata(markdown)
    name = _optional_text(request.name) or _metadata_text(metadata, "name", "title") or "未命名通用技能"
    slug = _optional_text(request.slug) or _metadata_text(metadata, "slug", "id") or _slugify(name)
    description = _optional_text(request.description) or _metadata_text(metadata, "description", "summary")
    homepage = _optional_text(request.homepage) or _metadata_text(metadata, "homepage", "url", "source")
    _validate_slug(slug)
    lookup_slug = _optional_text(request.original_slug)
    row = None
    if lookup_slug:
        row = db.exec(
            select(GeneralSkill).where(
                GeneralSkill.tenant_id == request.tenant_id,
                GeneralSkill.slug == lookup_slug,
            )
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="General skill to update was not found")
    else:
        conflict = db.exec(
            select(GeneralSkill).where(
                GeneralSkill.tenant_id == request.tenant_id,
                GeneralSkill.slug == slug,
            )
        ).first()
        if conflict:
            raise HTTPException(status_code=409, detail="General skill slug already exists")
    now = utc_now()
    if row:
        if slug != row.slug:
            conflict = db.exec(
                select(GeneralSkill).where(
                    GeneralSkill.tenant_id == request.tenant_id,
                    GeneralSkill.slug == slug,
                )
            ).first()
            if conflict:
                raise HTTPException(status_code=409, detail="General skill slug already exists")
        row.slug = slug
        row.name = name
        row.description = description
        row.homepage = homepage
        row.skill_markdown = markdown
        row.skill_files_json = [file.model_dump(mode="json") for file in files]
        row.metadata_json = metadata
        row.status = request.status
        row.updated_at = now
    else:
        row = GeneralSkill(
            tenant_id=request.tenant_id,
            slug=slug,
            name=name,
            description=description,
            homepage=homepage,
            skill_markdown=markdown,
            skill_files_json=[file.model_dump(mode="json") for file in files],
            metadata_json=metadata,
            status=request.status,
            permissions_json={"network": True, "python": True},
            runtime_config_json={"runtime": "python", "timeout_seconds": 12},
            created_at=now,
            updated_at=now,
        )
    db.add(row)
    db.commit()
    db.refresh(row)
    return general_skill_read(row)


@router.get("", response_model=list[GeneralSkillRead])
def list_general_skills(
    tenant_id: str = Query(...),
    db: Session = Depends(get_session),
) -> list[GeneralSkillRead]:
    ensure_tenant(db, tenant_id)
    rows = db.exec(
        select(GeneralSkill).where(GeneralSkill.tenant_id == tenant_id).order_by(GeneralSkill.updated_at.desc())
    ).all()
    return [general_skill_read(row) for row in rows]


@router.get("/{slug}", response_model=GeneralSkillRead)
def get_general_skill(
    slug: str,
    tenant_id: str = Query(...),
    db: Session = Depends(get_session),
) -> GeneralSkillRead:
    return general_skill_read(_get_general_skill(db, tenant_id, slug))


@router.post("/{slug}/run", response_model=GeneralSkillRunResponse)
def run_general_skill(
    slug: str,
    request: GeneralSkillRunRequest,
    db: Session = Depends(get_session),
) -> GeneralSkillRunResponse:
    skill = _get_general_skill(db, request.tenant_id, slug)
    if skill.status != "published":
        raise HTTPException(status_code=400, detail="General skill is not published")
    model_config = _get_default_model(db, request.tenant_id)
    return GeneralSkillRunner().run(skill, request.query, model_config, request.user_id, request.max_attempts)


@router.post("/{slug}/run/stream")
def run_general_skill_stream(
    slug: str,
    request: GeneralSkillRunRequest,
    db: Session = Depends(get_session),
) -> StreamingResponse:
    skill = _get_general_skill(db, request.tenant_id, slug)
    if skill.status != "published":
        raise HTTPException(status_code=400, detail="General skill is not published")
    model_config = _get_default_model(db, request.tenant_id)
    skill_snapshot = _general_skill_snapshot(skill)
    model_snapshot = _model_config_snapshot(model_config)

    def stream_events() -> Iterator[str]:
        events: queue.Queue[tuple[str, dict[str, object]] | None] = queue.Queue()

        def sink(item: dict[str, object]) -> None:
            events.put(("trace", item))

        def worker() -> None:
            try:
                response = GeneralSkillRunner().run(
                    skill_snapshot,
                    request.query,
                    model_snapshot,
                    request.user_id,
                    request.max_attempts,
                    sink,
                )
                events.put(("complete", response.model_dump(mode="json")))
            except Exception as exc:  # pragma: no cover - defensive stream boundary
                events.put(("error", {"message": str(exc)}))
            finally:
                events.put(None)

        threading.Thread(target=worker, daemon=True).start()
        yield _sse("stream_started", {"skill_slug": skill_snapshot.slug, "max_attempts": request.max_attempts})
        while True:
            item = events.get()
            if item is None:
                return
            event, payload = item
            yield _sse(event, payload)

    return StreamingResponse(stream_events(), media_type="text/event-stream")


def _get_general_skill(db: Session, tenant_id: str, slug: str) -> GeneralSkill:
    ensure_tenant(db, tenant_id)
    row = db.exec(
        select(GeneralSkill).where(GeneralSkill.tenant_id == tenant_id, GeneralSkill.slug == slug)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="General skill not found")
    return row


def _get_default_model(db: Session, tenant_id: str) -> ModelConfig:
    model_config = db.exec(
        select(ModelConfig).where(
            ModelConfig.tenant_id == tenant_id,
            ModelConfig.is_default == True,  # noqa: E712
            ModelConfig.enabled == True,  # noqa: E712
        )
    ).first()
    if not model_config:
        raise HTTPException(status_code=400, detail="No default model config")
    return model_config


def _general_skill_snapshot(row: GeneralSkill) -> SimpleNamespace:
    return SimpleNamespace(
        tenant_id=row.tenant_id,
        slug=row.slug,
        name=row.name,
        description=row.description,
        homepage=row.homepage,
        skill_markdown=row.skill_markdown,
        skill_files_json=_skill_files_or_markdown(row),
        metadata_json=row.metadata_json or {},
        status=row.status,
    )


def _model_config_snapshot(row: ModelConfig) -> SimpleNamespace:
    return SimpleNamespace(
        api_key_encrypted=row.api_key_encrypted,
        base_url=row.base_url,
        model=row.model,
        temperature=row.temperature,
        max_output_tokens=row.max_output_tokens,
    )


def _required_text(value: str | None, field: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail=f"General skill {field} cannot be empty")
    return cleaned


def _optional_text(value: str | None) -> str | None:
    cleaned = (value or "").strip()
    return cleaned or None


def _normalize_skill_files(
    requested_files: list[GeneralSkillFile],
    markdown: str | None,
) -> list[GeneralSkillFile]:
    if not requested_files:
        content = _required_text(markdown, "markdown")
        return [GeneralSkillFile(path="SKILL.md", content=content, size=len(content.encode("utf-8")))]
    cleaned_files: list[GeneralSkillFile] = []
    for file in requested_files:
        path = _clean_package_path(file.path)
        content = file.content or ""
        cleaned_files.append(
            GeneralSkillFile(
                path=path,
                content=content,
                size=file.size if file.size is not None else len(content.encode("utf-8")),
                mime_type=file.mime_type,
            )
        )
    skill_file = _find_skill_file(cleaned_files)
    if not skill_file:
        raise HTTPException(status_code=400, detail="General skill folder must contain SKILL.md")
    base_dir = skill_file.path.rsplit("/", 1)[0] if "/" in skill_file.path else ""
    if not base_dir:
        return cleaned_files
    normalized: list[GeneralSkillFile] = []
    prefix = f"{base_dir}/"
    for file in cleaned_files:
        if file.path == base_dir or not file.path.startswith(prefix):
            continue
        normalized.append(file.model_copy(update={"path": file.path[len(prefix):]}))
    return normalized


def _clean_package_path(path: str) -> str:
    cleaned = str(path or "").replace("\\", "/").strip().strip("/")
    parts = [part for part in cleaned.split("/") if part not in {"", "."}]
    if not parts or any(part == ".." for part in parts):
        raise HTTPException(status_code=400, detail=f"Invalid general skill file path: {path}")
    return "/".join(parts)


def _find_skill_file(files: list[GeneralSkillFile]) -> GeneralSkillFile | None:
    return next((file for file in files if file.path.rsplit("/", 1)[-1].lower() == "skill.md"), None)


def _skill_markdown_from_files(files: list[GeneralSkillFile]) -> str:
    skill_file = _find_skill_file(files)
    if not skill_file or not skill_file.content.strip():
        raise HTTPException(status_code=400, detail="General skill SKILL.md cannot be empty")
    return skill_file.content


def _skill_files_or_markdown(row: GeneralSkill) -> list[dict[str, object]]:
    files = row.skill_files_json or []
    if files:
        return files
    return [{"path": "SKILL.md", "content": row.skill_markdown, "size": len(row.skill_markdown.encode("utf-8"))}]


def _parse_skill_metadata(markdown: str) -> dict[str, object]:
    lines = markdown.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    metadata: dict[str, object] = {}
    for line in lines[1:]:
        stripped = line.strip()
        if stripped == "---":
            return metadata
        if not stripped or stripped.startswith("#") or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        key = key.strip()
        if not key:
            continue
        metadata[key] = _parse_metadata_value(value.strip())
    return metadata


def _parse_metadata_value(value: str) -> object:
    cleaned = value.strip().strip("'\"")
    if cleaned.startswith("[") and cleaned.endswith("]"):
        return [
            item.strip().strip("'\"")
            for item in cleaned[1:-1].split(",")
            if item.strip()
        ]
    return cleaned


def _metadata_text(metadata: dict[str, object], *keys: str) -> str | None:
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().lower()).strip("-_")
    return slug or "general-skill"


def _validate_slug(value: str) -> None:
    if any(char.isspace() for char in value) or "/" in value:
        raise HTTPException(status_code=400, detail="General skill slug cannot contain spaces or slashes")


def _sse(event: object, data: object) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"
