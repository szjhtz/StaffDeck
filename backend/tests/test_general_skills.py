from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.general_skills import import_general_skill, list_general_skills
from app.core import AgentLoop
from app.db.models import GeneralSkill, ModelConfig, Tenant, User
from app.general_skills.parser import parse_skill_markdown
from app.general_skills.schema import GeneralSkillImportRequest
from app.llm import LLMClient
from app.security.auth import hash_password
from app.security.encryption import encrypt_secret
from app.session.session_schema import ChatTurnRequest


WEATHER_SKILL_MD = """---
name: 中国城市天气
slug: weather-zh
description: 中国城市天气查询工具
homepage: https://www.weather.com.cn/
---

# 中国城市天气查询工具

python weather.py -json -today <地区名称>
"""


def test_parse_skill_markdown_frontmatter() -> None:
    parsed = parse_skill_markdown(WEATHER_SKILL_MD)

    assert parsed.name == "中国城市天气"
    assert parsed.slug == "weather-zh"
    assert parsed.description == "中国城市天气查询工具"
    assert parsed.homepage == "https://www.weather.com.cn/"


def test_import_general_skill_upserts_by_slug() -> None:
    with _test_session() as db:
        _seed_minimal_tenant(db)

        first = import_general_skill(
            GeneralSkillImportRequest(tenant_id="tenant_demo", markdown=WEATHER_SKILL_MD),
            db,
        )
        second = import_general_skill(
            GeneralSkillImportRequest(
                tenant_id="tenant_demo",
                markdown=WEATHER_SKILL_MD.replace("中国城市天气查询工具", "天气 demo"),
            ),
            db,
        )

        rows = list_general_skills("tenant_demo", db)
        assert first.id == second.id
        assert len(rows) == 1
        assert rows[0].slug == "weather-zh"
        assert rows[0].description == "天气 demo"


def test_chat_turn_uses_general_skill_before_scenario_router(monkeypatch) -> None:
    calls: list[str] = []

    def fake_init(self, model_config):  # noqa: ANN001
        return None

    def fake_generate_json(self, system_prompt, payload):  # noqa: ANN001
        prompt_text = str(system_prompt)
        if "通用技能选择器" in prompt_text:
            calls.append("selector")
            return {
                "use_general_skill": True,
                "selected_slug": "weather-zh",
                "confidence": 0.96,
                "reason": "用户询问天气。",
            }
        if "通用技能执行器" in prompt_text:
            calls.append("runner")
            code = (
                "import json\n"
                "payload=json.loads(input())\n"
                "print(json.dumps({'success': True, 'city': '北京', 'weather': '晴', 'query': payload['query']}, ensure_ascii=False))\n"
            )
            return {"code": code, "rationale": "天气查询 demo"}
        if "通用技能结果回复器" in prompt_text:
            calls.append("reply")
            assert payload["structured_result"]["weather"] == "晴"
            return {"reply": "北京今天晴，适合出门。"}
        raise AssertionError("scenario router should not be called")

    monkeypatch.setattr(LLMClient, "__init__", fake_init)
    monkeypatch.setattr(LLMClient, "generate_json", fake_generate_json)

    with _test_session() as db:
        _seed_minimal_tenant(db)
        db.add(
            GeneralSkill(
                tenant_id="tenant_demo",
                slug="weather-zh",
                name="中国城市天气",
                description="中国城市天气查询工具",
                homepage="https://www.weather.com.cn/",
                skill_markdown=WEATHER_SKILL_MD,
                status="published",
            )
        )
        db.commit()

        response = AgentLoop(db).handle_turn(
            ChatTurnRequest(
                tenant_id="tenant_demo",
                user_id="user_demo",
                message="北京今天天气怎么样",
            )
        )

        assert response.reply == "北京今天晴，适合出门。"
        assert calls == ["selector", "runner", "reply"]
        stored = db.exec(select(GeneralSkill).where(GeneralSkill.slug == "weather-zh")).first()
        assert stored is not None


def _seed_minimal_tenant(db: Session) -> None:
    db.add(Tenant(id="tenant_demo", name="Demo"))
    db.add(
        User(
            id="user_demo",
            tenant_id="tenant_demo",
            username="user_demo",
            password_hash=hash_password("demo"),
        )
    )
    db.add(
        ModelConfig(
            tenant_id="tenant_demo",
            name="Fake model",
            api_key_encrypted=encrypt_secret("test-key"),
            model="fake",
            is_default=True,
            enabled=True,
        )
    )
    db.commit()


def _test_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)
