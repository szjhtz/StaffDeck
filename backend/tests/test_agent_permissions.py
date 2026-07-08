from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.agents.schema import (
    AgentProfileCreateRequest,
    AgentProfileUpdateRequest,
    AgentResourceBindingInput,
    AgentResourcesUpdateRequest,
)
from app.api.agents import create_agent, delete_agent, list_agents, update_agent, update_agent_resources
from app.api.tools import create_tool
from app.db.models import AgentProfile, AgentResourceBinding, Tenant, Tool, User
from app.security.permissions import ensure_agent_scope_manager
from app.tools.tool_schema import ToolCreateRequest


def test_only_creator_or_admin_can_update_and_delete_agent() -> None:
    with _test_session() as db:
        owner, other, admin = _seed_users(db)
        agent = AgentProfile(
            id="agent_owned",
            tenant_id="tenant_demo",
            name="研发员工",
            is_overall=False,
            metadata_json={"owner_user_id": owner.id, "owner_username": owner.username},
        )
        db.add(agent)
        db.commit()

        with pytest.raises(HTTPException) as update_error:
            update_agent(
                agent.id,
                AgentProfileUpdateRequest(tenant_id="tenant_demo", name="非法修改"),
                db=db,
                current_user=other,
            )
        assert update_error.value.status_code == 403

        updated = update_agent(
            agent.id,
            AgentProfileUpdateRequest(tenant_id="tenant_demo", name="Owner 修改"),
            db=db,
            current_user=owner,
        )
        assert updated.name == "Owner 修改"

        admin_updated = update_agent(
            agent.id,
            AgentProfileUpdateRequest(tenant_id="tenant_demo", name="Admin 修改"),
            db=db,
            current_user=admin,
        )
        assert admin_updated.name == "Admin 修改"

        with pytest.raises(HTTPException) as delete_error:
            delete_agent(agent.id, tenant_id="tenant_demo", db=db, current_user=other)
        assert delete_error.value.status_code == 403


def test_non_admin_cannot_manage_overall_agent() -> None:
    with _test_session() as db:
        owner, _other, admin = _seed_users(db)
        overall = AgentProfile(id="agent_overall", tenant_id="tenant_demo", name="开放广场", is_overall=True)
        db.add(overall)
        db.commit()

        with pytest.raises(HTTPException) as update_error:
            update_agent(
                overall.id,
                AgentProfileUpdateRequest(tenant_id="tenant_demo", description="普通用户不能改整体员工"),
                db=db,
                current_user=owner,
            )
        assert update_error.value.status_code == 403

        updated = update_agent(
            overall.id,
            AgentProfileUpdateRequest(tenant_id="tenant_demo", description="管理员可以维护整体员工"),
            db=db,
            current_user=admin,
        )
        assert updated.description == "管理员可以维护整体员工"


def test_resource_binding_requires_agent_manager() -> None:
    with _test_session() as db:
        owner, other, _admin = _seed_users(db)
        agent = AgentProfile(
            id="agent_resource_owner",
            tenant_id="tenant_demo",
            name="资源员工",
            is_overall=False,
            metadata_json={"owner_user_id": owner.id, "owner_username": owner.username},
        )
        tool = Tool(id="tool_weather", tenant_id="tenant_demo", name="weather", display_name="天气查询", method="POST", url="/weather")
        db.add(agent)
        db.add(tool)
        db.commit()
        request = AgentResourcesUpdateRequest(
            tenant_id="tenant_demo",
            resources=[AgentResourceBindingInput(resource_type="tool", resource_id=tool.id)],
        )

        with pytest.raises(HTTPException) as update_error:
            update_agent_resources(agent.id, request, db=db, current_user=other)
        assert update_error.value.status_code == 403

        bindings = update_agent_resources(agent.id, request, db=db, current_user=owner)
        assert [(item.resource_type, item.resource_id) for item in bindings] == [("tool", tool.id)]


def test_list_agents_filters_to_visible_agents_for_non_admin() -> None:
    with _test_session() as db:
        owner, other, admin = _seed_users(db)
        db.add(AgentProfile(id="agent_overall", tenant_id="tenant_demo", name="整体", is_overall=True))
        db.add(
            AgentProfile(
                id="agent_owned",
                tenant_id="tenant_demo",
                name="我的员工",
                is_overall=False,
                metadata_json={"owner_user_id": owner.id, "owner_username": owner.username},
            )
        )
        db.add(
            AgentProfile(
                id="agent_gallery",
                tenant_id="tenant_demo",
                name="广场员工",
                is_overall=False,
                metadata_json={"published_to_gallery": True, "owner_username": other.username},
            )
        )
        db.add(
            AgentProfile(
                id="agent_private",
                tenant_id="tenant_demo",
                name="别人私有员工",
                is_overall=False,
                metadata_json={"owner_user_id": other.id, "owner_username": other.username},
            )
        )
        db.commit()

        owner_rows = list_agents("tenant_demo", db=db, current_user=owner)
        admin_rows = list_agents("tenant_demo", db=db, current_user=admin)

        assert {row.id for row in owner_rows} == {"agent_overall", "agent_owned", "agent_gallery"}
        assert {row.id for row in admin_rows} == {"agent_overall", "agent_owned", "agent_gallery", "agent_private"}


def test_gallery_agent_is_visible_but_not_manageable_by_non_owner() -> None:
    with _test_session() as db:
        owner, other, admin = _seed_users(db)
        gallery_agent = AgentProfile(
            id="agent_gallery",
            tenant_id="tenant_demo",
            name="广场员工",
            is_overall=False,
            metadata_json={
                "published_to_gallery": True,
                "owner_user_id": other.id,
                "owner_username": other.username,
            },
        )
        db.add(gallery_agent)
        db.commit()

        owner_visible_rows = list_agents("tenant_demo", db=db, current_user=owner)
        assert {row.id for row in owner_visible_rows} == {"agent_gallery"}

        with pytest.raises(HTTPException) as manage_error:
            ensure_agent_scope_manager(db, "tenant_demo", gallery_agent.id, owner)
        assert manage_error.value.status_code == 403

        assert ensure_agent_scope_manager(db, "tenant_demo", gallery_agent.id, other).id == gallery_agent.id
        assert ensure_agent_scope_manager(db, "tenant_demo", gallery_agent.id, admin).id == gallery_agent.id

        with pytest.raises(HTTPException) as create_error:
            create_tool(
                ToolCreateRequest(
                    tenant_id="tenant_demo",
                    name="blocked_gallery_tool",
                    display_name="不应创建",
                    url="/blocked",
                ),
                agent_id=gallery_agent.id,
                db=db,
                current_user=owner,
            )
        assert create_error.value.status_code == 403
        assert db.exec(select(Tool).where(Tool.name == "blocked_gallery_tool")).first() is None


def test_create_agent_records_creator_and_blocks_non_admin_overall() -> None:
    with _test_session() as db:
        owner, _other, admin = _seed_users(db)

        created = create_agent(
            AgentProfileCreateRequest(tenant_id="tenant_demo", name="新员工", source_mode="blank"),
            db=db,
            current_user=owner,
        )
        assert created.metadata["owner_user_id"] == owner.id
        assert created.metadata["owner_username"] == owner.username
        assert created.metadata["created_by_user_id"] == owner.id
        assert created.metadata["created_by_username"] == owner.username

        with pytest.raises(HTTPException) as create_error:
            create_agent(
                AgentProfileCreateRequest(tenant_id="tenant_demo", name="普通用户整体", is_overall=True),
                db=db,
                current_user=owner,
            )
        assert create_error.value.status_code == 403

        overall = create_agent(
            AgentProfileCreateRequest(tenant_id="tenant_demo", name="管理员整体", is_overall=True, source_mode="blank"),
            db=db,
            current_user=admin,
        )
        assert overall.is_overall is True


def _seed_users(db: Session) -> tuple[User, User, User]:
    db.add(Tenant(id="tenant_demo", name="Demo"))
    owner = User(id="user_owner", tenant_id="tenant_demo", username="owner", display_name="Owner", password_hash="x")
    other = User(id="user_other", tenant_id="tenant_demo", username="other", display_name="Other", password_hash="x")
    admin = User(id="user_admin", tenant_id="tenant_demo", username="admin", display_name="Admin", password_hash="x")
    db.add(owner)
    db.add(other)
    db.add(admin)
    db.commit()
    return owner, other, admin


def _test_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)
