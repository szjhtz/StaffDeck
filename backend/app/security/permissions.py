from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session

from app.db.models import AgentProfile, User

ADMIN_USERNAMES = {"admin", "admin_demo"}


def dependency_user(current_user: object) -> User | None:
    return current_user if isinstance(current_user, User) else None


def is_admin_user(current_user: object) -> bool:
    user = dependency_user(current_user)
    return bool(user and user.username in ADMIN_USERNAMES)


def ensure_open_gallery_admin(tenant_id: str, current_user: object) -> None:
    user = dependency_user(current_user)
    if not user:
        return
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    if user.username not in ADMIN_USERNAMES:
        raise HTTPException(status_code=403, detail="Only administrator can update the open gallery")


def ensure_agent_scope_manager(
    db: Session,
    tenant_id: str,
    agent_id: str | None,
    current_user: object | None,
) -> AgentProfile | None:
    if not agent_id:
        return None
    row = db.get(AgentProfile, agent_id)
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Agent not found")
    user = dependency_user(current_user)
    if not user:
        return row
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    if user.username in ADMIN_USERNAMES:
        return row
    if row.is_overall:
        raise HTTPException(status_code=403, detail="Only administrator can manage overall agent")
    if agent_owned_by_user(row, user):
        return row
    raise HTTPException(status_code=403, detail="Only the creator or administrator can manage this staff")


def agent_owned_by_user(row: AgentProfile, user: User) -> bool:
    metadata = row.metadata_json or {}
    owner_ids = _metadata_user_values(metadata, "owner_user_id", "created_by_user_id")
    owner_names = _metadata_user_values(metadata, "owner_username", "created_by_username")
    return user.id in owner_ids or user.username in owner_names


def _metadata_user_values(metadata: dict[str, object], *keys: str) -> set[str]:
    values: set[str] = set()
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            values.add(value.strip())
    return values
