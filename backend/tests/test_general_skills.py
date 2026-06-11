from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.api.general_skills import import_general_skill, list_general_skills
from app.core import AgentLoop
from app.db.models import AgentEvent, ChatSession, GeneralSkill, ModelConfig, Skill, Tenant, User
from app.general_skills.runner import GeneralSkillRunner
from app.general_skills.schema import GeneralSkillImportRequest
from app.llm import LLMClient, LLMError
from app.security.auth import hash_password
from app.security.encryption import encrypt_secret
from app.session.session_schema import ChatTurnRequest


WEATHER_SKILL_MD = """# 中国城市天气查询工具

python weather.py -json -today <地区名称>
"""


def test_import_general_skill_uses_user_supplied_metadata() -> None:
    with _test_session() as db:
        _seed_minimal_tenant(db)

        first = import_general_skill(
            GeneralSkillImportRequest(
                tenant_id="tenant_demo",
                name="用户填写天气技能",
                slug="weather-zh",
                description="用户填写描述",
                homepage="https://example.com/weather",
                markdown=WEATHER_SKILL_MD,
            ),
            db,
        )
        second = import_general_skill(
            GeneralSkillImportRequest(
                tenant_id="tenant_demo",
                name="用户改名天气技能",
                slug="weather-cn",
                description="用户改写描述",
                homepage="https://example.com/weather-cn",
                original_slug="weather-zh",
                markdown=WEATHER_SKILL_MD.replace("中国城市天气查询工具", "天气 demo"),
            ),
            db,
        )

        rows = list_general_skills("tenant_demo", db)
        assert first.id == second.id
        assert len(rows) == 1
        assert rows[0].slug == "weather-cn"
        assert rows[0].name == "用户改名天气技能"
        assert rows[0].description == "用户改写描述"
        assert rows[0].homepage == "https://example.com/weather-cn"
        assert rows[0].skill_markdown.startswith("# 天气 demo")


def test_import_general_skill_without_original_slug_does_not_overwrite_existing() -> None:
    with _test_session() as db:
        _seed_minimal_tenant(db)

        first = import_general_skill(
            GeneralSkillImportRequest(
                tenant_id="tenant_demo",
                name="已有天气技能",
                slug="weather-zh",
                markdown=WEATHER_SKILL_MD,
            ),
            db,
        )

        try:
            import_general_skill(
                GeneralSkillImportRequest(
                    tenant_id="tenant_demo",
                    name="新导入天气技能",
                    slug="weather-zh",
                    markdown="# 新内容",
                ),
                db,
            )
        except HTTPException as error:
            assert error.status_code == 409
        else:
            raise AssertionError("expected slug conflict")

        rows = list_general_skills("tenant_demo", db)
        assert len(rows) == 1
        assert rows[0].id == first.id
        assert rows[0].name == "已有天气技能"
        assert rows[0].skill_markdown == WEATHER_SKILL_MD.strip()


def test_import_general_skill_folder_reads_skill_md_metadata() -> None:
    with _test_session() as db:
        _seed_minimal_tenant(db)

        row = import_general_skill(
            GeneralSkillImportRequest(
                tenant_id="tenant_demo",
                files=[
                    {
                        "path": "weather-bundle/SKILL.md",
                        "content": (
                            "---\n"
                            "name: 中国城市天气\n"
                            "slug: weather-zh\n"
                            "description: 从目录包读取天气技能\n"
                            "homepage: https://example.com/weather\n"
                            "---\n\n"
                            "# 使用说明\n"
                            "读取 data/cities.json 完成查询。\n"
                        ),
                    },
                    {
                        "path": "weather-bundle/data/cities.json",
                        "content": "{\"北京\": \"101010100\"}",
                    },
                ],
            ),
            db,
        )

        assert row.name == "中国城市天气"
        assert row.slug == "weather-zh"
        assert row.description == "从目录包读取天气技能"
        assert row.homepage == "https://example.com/weather"
        assert row.metadata["name"] == "中国城市天气"
        assert [file.path for file in row.skill_files] == ["SKILL.md", "data/cities.json"]
        assert row.skill_markdown.startswith("---\nname: 中国城市天气")


def test_chat_turn_uses_general_skill_after_scene_router_skips_unmatched_scene(
    monkeypatch,
) -> None:
    calls: list[str] = []

    def fake_init(self, model_config):  # noqa: ANN001
        return None

    def fake_generate_json(self, system_prompt, payload):  # noqa: ANN001
        prompt_text = str(system_prompt)
        if "企业技能路由器" in prompt_text:
            calls.append("router")
            return {
                "decision": "clarify",
                "target_skill_id": "skill_weather_query",
                "target_step_id": "step_query_weather",
                "confidence": 0.85,
                "user_intent": "查询海淀区天气",
                "reason": "模型错误地假设存在天气流程。",
            }
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
                "print(json.dumps({'success': True, 'city': '海淀区', 'weather': '晴', 'query': payload['query']}, ensure_ascii=False))\n"
            )
            return {"code": code, "rationale": "天气查询 demo"}
        if "通用技能结果回复器" in prompt_text:
            calls.append("reply")
            assert payload["structured_result"]["weather"] == "晴"
            return {"reply": "海淀区今天晴。"}
        if "企业技能执行助手" in prompt_text:
            raise AssertionError("step agent should not run without an active scene skill")
        raise AssertionError("unexpected JSON prompt")

    def fake_generate_text(self, system_prompt, payload):  # noqa: ANN001
        calls.append("response")
        assert payload["session"]["active_skill_id"] is None
        assert payload["tool_result"]["tool_name"] == "general_skill.weather-zh"
        assert payload["tool_result"]["success"] is True
        assert payload["tool_result"]["data"]["structured_result"]["weather"] == "晴"
        assert payload["step_result"]["reply"] == "海淀区今天晴。"
        return "海淀区今天晴。"

    monkeypatch.setattr(LLMClient, "__init__", fake_init)
    monkeypatch.setattr(LLMClient, "generate_json", fake_generate_json)
    monkeypatch.setattr(LLMClient, "generate_text", fake_generate_text)

    with _test_session() as db:
        _seed_minimal_tenant(db)
        db.add(_purchase_scene_skill())
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
                message="我想看下海淀区的天气",
            )
        )

        assert response.reply == "海淀区今天晴。"
        assert calls == ["router", "selector", "runner", "reply", "response"]
        assert response.tool_result is not None
        assert response.tool_result.tool_name == "general_skill.weather-zh"
        assert response.router_decision is not None
        assert response.router_decision.target_skill_id is None
        events = db.exec(select(AgentEvent).where(AgentEvent.session_id == response.session_id)).all()
        event_types = {event.event_type for event in events}
        assert "general_skill_selected" in event_types
        assert "tool_call_started" not in event_types
        assert "step_agent_result_created" not in event_types


def test_general_skill_response_keeps_active_scene_context(monkeypatch) -> None:
    calls: list[str] = []

    def fake_init(self, model_config):  # noqa: ANN001
        return None

    def fake_generate_json(self, system_prompt, payload):  # noqa: ANN001
        prompt_text = str(system_prompt)
        if "企业技能路由器" in prompt_text:
            calls.append("router")
            return {
                "decision": "answer_related_question_then_resume",
                "confidence": 0.9,
                "user_intent": "购买流程中插入天气查询",
                "reason": "用户在购买流程中询问天气，需要先回答相关问题。",
            }
        if "通用技能选择器" in prompt_text:
            calls.append("selector")
            return {
                "use_general_skill": True,
                "selected_slug": "weather-zh",
                "confidence": 0.96,
                "reason": "用户询问海淀天气。",
            }
        if "通用技能执行器" in prompt_text:
            calls.append("runner")
            code = (
                "import json\n"
                "payload=json.loads(input())\n"
                "print(json.dumps({'success': True, 'city': '海淀', 'weather': '晴', 'query': payload['query']}, ensure_ascii=False))\n"
            )
            return {"code": code, "rationale": "天气查询 demo"}
        if "通用技能结果回复器" in prompt_text:
            calls.append("reply")
            assert payload["structured_result"]["city"] == "海淀"
            return {"reply": "海淀当前天气晴。"}
        if "企业技能执行助手" in prompt_text:
            raise AssertionError("scene step agent should not run for inserted general skill answer")
        raise AssertionError("unexpected JSON prompt")

    def fake_generate_text(self, system_prompt, payload):  # noqa: ANN001
        calls.append("response")
        assert payload["session"]["active_skill_id"] == "purchase"
        assert payload["session"]["active_step_id"] == "collect_product"
        assert payload["session"]["slots"]["user_name"] == "hm"
        assert payload["tool_result"]["tool_name"] == "general_skill.weather-zh"
        assert payload["tool_result"]["data"]["reply"] == "海淀当前天气晴。"
        return "海淀当前天气晴。天气合适的话，请继续告诉我想购买的商品和数量。"

    monkeypatch.setattr(LLMClient, "__init__", fake_init)
    monkeypatch.setattr(LLMClient, "generate_json", fake_generate_json)
    monkeypatch.setattr(LLMClient, "generate_text", fake_generate_text)

    with _test_session() as db:
        _seed_minimal_tenant(db)
        db.add(_purchase_scene_skill())
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
        db.add(
            ChatSession(
                id="session_weather_inside_purchase",
                tenant_id="tenant_demo",
                user_id="user_demo",
                active_skill_id="purchase",
                active_step_id="collect_product",
                slots_json={"user_name": "hm"},
            )
        )
        db.commit()

        response = AgentLoop(db).handle_turn(
            ChatTurnRequest(
                tenant_id="tenant_demo",
                session_id="session_weather_inside_purchase",
                user_id="user_demo",
                message="诶？现在海淀天气怎么样，天气好我就出门买了",
            )
        )

        assert response.reply == "海淀当前天气晴。天气合适的话，请继续告诉我想购买的商品和数量。"
        assert response.tool_result is not None
        assert response.session_state.active_skill_id == "purchase"
        assert response.session_state.active_step_id == "collect_product"
        assert calls == ["router", "selector", "runner", "reply", "response"]


def test_chat_turn_treats_unmatched_scene_as_chat_when_general_skill_not_selected(
    monkeypatch,
) -> None:
    calls: list[str] = []

    def fake_init(self, model_config):  # noqa: ANN001
        return None

    def fake_generate_json(self, system_prompt, payload):  # noqa: ANN001
        prompt_text = str(system_prompt)
        if "企业技能路由器" in prompt_text:
            calls.append("router")
            return {
                "decision": "answer_only",
                "confidence": 0.95,
                "user_intent": "普通闲聊",
                "reason": "用户没有匹配任何业务流程。",
            }
        if "通用技能选择器" in prompt_text:
            calls.append("selector")
            return {
                "use_general_skill": False,
                "selected_slug": None,
                "confidence": 0.2,
                "reason": "没有匹配的通用技能。",
            }
        if "企业技能执行助手" in prompt_text:
            raise AssertionError("step agent should not run without an active scene skill")
        raise AssertionError("unexpected JSON prompt")

    def fake_generate_text(self, system_prompt, payload):  # noqa: ANN001
        calls.append("response")
        assert payload["active_skill"] is None
        assert payload["router_decision"]["decision"] == "answer_only"
        assert payload["tool_result"] is None
        return "你好，有什么业务需要我帮忙？"

    monkeypatch.setattr(LLMClient, "__init__", fake_init)
    monkeypatch.setattr(LLMClient, "generate_json", fake_generate_json)
    monkeypatch.setattr(LLMClient, "generate_text", fake_generate_text)

    with _test_session() as db:
        _seed_minimal_tenant(db)
        db.add(_purchase_scene_skill())
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
                message="你好",
            )
        )

        assert response.reply == "你好，有什么业务需要我帮忙？"
        assert calls == ["router", "selector", "response"]
        events = db.exec(select(AgentEvent).where(AgentEvent.session_id == response.session_id)).all()
        event_types = {event.event_type for event in events}
        assert "general_skill_selected" not in event_types
        assert "tool_call_started" not in event_types
        assert "step_agent_result_created" not in event_types


def test_general_skill_runner_repairs_failed_code(monkeypatch) -> None:
    calls: list[str] = []

    def fake_init(self, model_config):  # noqa: ANN001
        return None

    def fake_generate_json(self, system_prompt, payload):  # noqa: ANN001
        prompt_text = str(system_prompt)
        if "代码修复器" in prompt_text:
            calls.append("repair")
            return {
                "code": (
                    "import json\n"
                    "payload=json.loads(input())\n"
                    "print(json.dumps({'success': True, 'city': '北京', 'weather': '晴', 'query': payload['query']}, ensure_ascii=False))\n"
                ),
                "rationale": "修复失败输出",
            }
        if "通用技能执行器" in prompt_text:
            calls.append("runner")
            return {
                "code": "import json\nprint(json.dumps({'success': False, 'error': 'first_fail'}, ensure_ascii=False))\n",
                "rationale": "首次尝试失败",
            }
        if "通用技能结果回复器" in prompt_text:
            calls.append("reply")
            assert payload["structured_result"]["success"] is True
            return {"reply": "北京今天晴。"}
        raise AssertionError("unexpected prompt")

    monkeypatch.setattr(LLMClient, "__init__", fake_init)
    monkeypatch.setattr(LLMClient, "generate_json", fake_generate_json)

    skill = GeneralSkill(
        tenant_id="tenant_demo",
        slug="weather-zh",
        name="中国城市天气",
        description="中国城市天气查询工具",
        homepage="https://www.weather.com.cn/",
        skill_markdown=WEATHER_SKILL_MD,
        status="published",
    )
    model_config = ModelConfig(
        tenant_id="tenant_demo",
        name="Fake model",
        api_key_encrypted=encrypt_secret("test-key"),
        model="fake",
        is_default=True,
        enabled=True,
    )

    events: list[dict] = []

    response = GeneralSkillRunner().run(skill, "北京今天天气怎么样", model_config, max_attempts=2, event_sink=events.append)

    assert response.reply == "北京今天晴。"
    assert response.structured_result["success"] is True
    assert calls == ["runner", "repair", "reply"]
    assert any(item["phase"] == "reflection_retrying" for item in response.execution_trace)
    assert any(item["phase"] == "stdout_chunk" and "first_fail" in item["text"] for item in events)


def test_general_skill_runner_materializes_folder_package(monkeypatch) -> None:
    calls: list[str] = []

    def fake_init(self, model_config):  # noqa: ANN001
        return None

    def fake_generate_json(self, system_prompt, payload):  # noqa: ANN001
        prompt_text = str(system_prompt)
        if "通用技能执行器" in prompt_text:
            calls.append("runner")
            assert payload["skill"]["package"]["file_count"] == 2
            assert [item["path"] for item in payload["skill"]["package"]["files"]] == ["SKILL.md", "data/city.txt"]
            return {
                "code": (
                    "import json\n"
                    "from pathlib import Path\n"
                    "payload=json.loads(input())\n"
                    "city=(Path(payload['skill_workspace'])/'data'/'city.txt').read_text(encoding='utf-8').strip()\n"
                    "print(json.dumps({'success': True, 'city': city, 'files': payload['skill_files']}, ensure_ascii=False))\n"
                ),
                "rationale": "读取技能目录里的数据文件。",
            }
        if "通用技能运行结果审查器" in prompt_text:
            calls.append("review")
            assert payload["structured_result"]["city"] == "北京"
            return {
                "result_sufficient": True,
                "needs_retry": False,
                "terminal": False,
                "reason": "目录文件已读取成功。",
            }
        if "通用技能结果回复器" in prompt_text:
            calls.append("reply")
            assert payload["structured_result"]["city"] == "北京"
            return {"reply": "已读取目录技能，城市是北京。"}
        raise AssertionError("unexpected prompt")

    monkeypatch.setattr(LLMClient, "__init__", fake_init)
    monkeypatch.setattr(LLMClient, "generate_json", fake_generate_json)

    skill = GeneralSkill(
        tenant_id="tenant_demo",
        slug="folder-weather",
        name="目录天气技能",
        description="读取目录内数据",
        skill_markdown="# 目录天气技能\n读取 data/city.txt。",
        skill_files_json=[
            {"path": "SKILL.md", "content": "# 目录天气技能\n读取 data/city.txt。"},
            {"path": "data/city.txt", "content": "北京"},
        ],
        status="published",
    )
    model_config = ModelConfig(
        tenant_id="tenant_demo",
        name="Fake model",
        api_key_encrypted=encrypt_secret("test-key"),
        model="fake",
        is_default=True,
        enabled=True,
    )

    response = GeneralSkillRunner().run(skill, "查一下目录里的城市", model_config, max_attempts=1)

    assert response.reply == "已读取目录技能，城市是北京。"
    assert response.structured_result["city"] == "北京"
    assert response.structured_result["files"] == ["SKILL.md", "data/city.txt"]
    assert calls == ["runner", "review", "reply"]


def test_general_skill_runner_reflects_failed_initial_plan(monkeypatch) -> None:
    calls: list[str] = []

    def fake_init(self, model_config):  # noqa: ANN001
        return None

    def fake_generate_json(self, system_prompt, payload):  # noqa: ANN001
        prompt_text = str(system_prompt)
        if "代码修复器" in prompt_text:
            calls.append("repair")
            assert payload["previous_attempts"][0]["structured_result"]["error"] == "plan_generation_failed"
            return {
                "code": (
                    "import json\n"
                    "payload=json.loads(input())\n"
                    "print(json.dumps({'success': True, 'city': '廊坊', 'weather': '多云', 'query': payload['query']}, ensure_ascii=False))\n"
                ),
                "rationale": "重新输出合法 runner JSON",
            }
        if "通用技能执行器" in prompt_text:
            calls.append("runner_failed")
            raise LLMError("Model did not return valid JSON after retry")
        if "通用技能结果回复器" in prompt_text:
            calls.append("reply")
            assert payload["structured_result"]["success"] is True
            return {"reply": "廊坊今天多云。"}
        raise AssertionError("unexpected prompt")

    monkeypatch.setattr(LLMClient, "__init__", fake_init)
    monkeypatch.setattr(LLMClient, "generate_json", fake_generate_json)

    skill = GeneralSkill(
        tenant_id="tenant_demo",
        slug="weather-zh",
        name="中国城市天气",
        description="中国城市天气查询工具",
        homepage="https://www.weather.com.cn/",
        skill_markdown=WEATHER_SKILL_MD,
        status="published",
    )
    model_config = ModelConfig(
        tenant_id="tenant_demo",
        name="Fake model",
        api_key_encrypted=encrypt_secret("test-key"),
        model="fake",
        is_default=True,
        enabled=True,
    )

    response = GeneralSkillRunner().run(skill, "廊坊天气", model_config, max_attempts=2)

    assert response.reply == "廊坊今天多云。"
    assert response.structured_result["success"] is True
    assert calls == ["runner_failed", "repair", "reply"]
    assert any(item["phase"] == "plan_failed" for item in response.execution_trace)
    assert any(item["phase"] == "reflection_retrying" for item in response.execution_trace)


def test_general_skill_runner_stops_on_non_retryable_failure(monkeypatch) -> None:
    calls: list[str] = []

    def fake_init(self, model_config):  # noqa: ANN001
        return None

    def fake_generate_json(self, system_prompt, payload):  # noqa: ANN001
        prompt_text = str(system_prompt)
        if "通用技能执行器" in prompt_text:
            calls.append("runner")
            return {
                "code": (
                    "import json\n"
                    "print(json.dumps({"
                    "'success': False, "
                    "'error': 'source_unavailable', "
                    "'message': '天气源不可用', "
                    "'attempted_urls': ['https://example.invalid/weather'], "
                    "'exception_type': 'TimeoutError', "
                    "'exception_message': 'timed out', "
                    "'retryable': False"
                    "}, ensure_ascii=False))\n"
                ),
                "rationale": "返回不可自动修复的失败",
            }
        if "代码修复器" in prompt_text:
            calls.append("repair")
            raise AssertionError("non-retryable failure should not call repair")
        if "通用技能结果回复器" in prompt_text:
            calls.append("reply")
            assert payload["structured_result"]["retryable"] is False
            return {"reply": "当前天气源不可用，建议稍后再试。"}
        raise AssertionError("unexpected prompt")

    monkeypatch.setattr(LLMClient, "__init__", fake_init)
    monkeypatch.setattr(LLMClient, "generate_json", fake_generate_json)

    skill = GeneralSkill(
        tenant_id="tenant_demo",
        slug="weather-zh",
        name="中国城市天气",
        description="中国城市天气查询工具",
        homepage="https://www.weather.com.cn/",
        skill_markdown=WEATHER_SKILL_MD,
        status="published",
    )
    model_config = ModelConfig(
        tenant_id="tenant_demo",
        name="Fake model",
        api_key_encrypted=encrypt_secret("test-key"),
        model="fake",
        is_default=True,
        enabled=True,
    )

    response = GeneralSkillRunner().run(skill, "北京今天天气怎么样", model_config, max_attempts=10)

    assert response.reply == "当前天气源不可用，建议稍后再试。"
    assert calls == ["runner", "reply"]
    assert any(item["phase"] == "reflection_stopped" for item in response.execution_trace)


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


def _purchase_scene_skill() -> Skill:
    return Skill(
        tenant_id="tenant_demo",
        skill_id="purchase",
        name="购买商品流程",
        description="帮助用户购买商品。",
        status="published",
        content_json={
            "business_domain": "commerce",
            "trigger_intents": ["购买", "下单"],
            "required_info": ["product_id"],
            "steps": [
                {
                    "step_id": "collect_product",
                    "name": "收集商品信息",
                    "instruction": "收集用户想购买的商品。",
                    "expected_user_info": ["product_id"],
                    "allowed_actions": ["ask_user", "continue_flow"],
                }
            ],
        },
    )


def _test_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)
