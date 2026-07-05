import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.db.models import AgentProfile, Tenant
from app.scheduled_tasks import service as scheduled_service
from app.scheduled_tasks.service import _fallback_draft


def test_fallback_draft_extracts_basic_time_without_inferring_once() -> None:
    message = "下午2点10分帮我看下A1的价格如果比A3便宜就购买"

    draft = _fallback_draft(message)

    assert draft is not None
    assert draft.schedule_type == "daily"
    assert draft.schedule == {"time": "14:10"}
    assert draft.confidence == 0.45
    assert "下午2点10分" in draft.prompt


def test_fallback_draft_extracts_basic_weekly_keyword() -> None:
    draft = _fallback_draft("每周五18点复盘差评对话")

    assert draft is not None
    assert draft.schedule_type == "weekly"
    assert draft.schedule == {"time": "18:00", "weekdays": [4]}


def test_fallback_draft_extracts_basic_weekday_from_xingqi_keyword() -> None:
    draft = _fallback_draft("星期天21点复盘服务投诉")

    assert draft is not None
    assert draft.schedule_type == "weekly"
    assert draft.schedule == {"time": "21:00", "weekdays": [6]}


def test_fallback_draft_extracts_basic_monthly_keyword() -> None:
    draft = _fallback_draft("每月15号晚上8点汇总服务投诉趋势")

    assert draft is not None
    assert draft.schedule_type == "monthly"
    assert draft.schedule == {"time": "20:00", "day_of_month": 15}


def test_fallback_draft_ignores_invalid_basic_time() -> None:
    draft = _fallback_draft("每天25点汇总服务投诉趋势")

    assert draft is not None
    assert draft.schedule_type == "daily"
    assert draft.schedule == {"time": "09:00"}


def test_fallback_draft_strips_configuration_prefix_only() -> None:
    draft = _fallback_draft("创建定时任务：复盘差评对话并给出 SOP 优化建议")

    assert draft is not None
    assert draft.schedule_type == "daily"
    assert draft.schedule["time"] == "09:00"
    assert "复盘差评对话" in draft.prompt
    assert draft.reason == "模型解析失败后的轻量关键词兜底草案"


def test_llm_draft_is_used_without_confidence_fallback(monkeypatch) -> None:
    with _test_session() as db:
        db.add(Tenant(id="tenant_demo", name="Demo"))
        db.add(AgentProfile(id="agent_demo", tenant_id="tenant_demo", name="客服", is_overall=False))
        db.commit()

        monkeypatch.setattr(
            scheduled_service,
            "_detect_with_llm",
            lambda *args, **kwargs: scheduled_service._LLMScheduledTaskDraft(
                should_create=True,
                title="模型解析的一次性任务",
                prompt="到点后检查 A1 价格并按条件购买",
                schedule_type="once",
                schedule={"run_at": "2026-06-22T14:10:00+08:00"},
                timezone="Asia/Shanghai",
                confidence=0.1,
                reason="模型已给出完整结构",
            ),
        )
        monkeypatch.setattr(
            scheduled_service,
            "_fallback_draft",
            lambda *_args, **_kwargs: pytest.fail("模型返回可用草案时不应进入 fallback"),
        )

        draft = scheduled_service.detect_scheduled_task_draft(
            db,
            "tenant_demo",
            "agent_demo",
            "user_demo",
            "下午2点10分帮我看下A1价格",
            "session_demo",
        )

        assert draft is not None
        assert draft.schedule_type == "once"
        assert draft.schedule["run_at"] == "2026-06-22T14:10:00+08:00"
        assert draft.confidence == 0.1


def test_llm_negative_result_does_not_fallback(monkeypatch) -> None:
    with _test_session() as db:
        db.add(Tenant(id="tenant_demo", name="Demo"))
        db.add(AgentProfile(id="agent_demo", tenant_id="tenant_demo", name="客服", is_overall=False))
        db.commit()

        monkeypatch.setattr(
            scheduled_service,
            "_detect_with_llm",
            lambda *args, **kwargs: scheduled_service._LLMScheduledTaskDraft(
                should_create=False,
                confidence=0.9,
                reason="不是自动任务",
            ),
        )
        monkeypatch.setattr(
            scheduled_service,
            "_fallback_draft",
            lambda *_args, **_kwargs: pytest.fail("模型明确拒绝创建时不应进入 fallback"),
        )

        draft = scheduled_service.detect_scheduled_task_draft(
            db,
            "tenant_demo",
            "agent_demo",
            "user_demo",
            "只是普通问题",
            "session_demo",
        )

        assert draft is None


def _test_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)
