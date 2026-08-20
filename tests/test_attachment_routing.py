#!/usr/bin/env python3
"""附件自动路由的运行时判定。

与 desktop/src/utils/attachment-routing.test.ts 是同一份契约的两侧实现：策略由服务端
下发，两边各自执行。这里的断言刻意和那边逐条对齐，漂了一眼就能看出来。
"""

from __future__ import annotations

import pytest

from agenticx.studio.attachment_routing import (
    ROUTING_OFF,
    apply_to_session,
    AttachmentRoutingPolicy,
    RoutingModelRef,
    decide,
    has_routed_document,
    lock_reason,
    read_policy,
    remember_lock,
    session_locked_target,
)

QWEN = RoutingModelRef(
    provider="qwen_local",
    model="qwen3.8-27b",
    label="本地推理/Qwen3.8 27B",
    id="qwen_local/qwen3.8-27b",
)

WIRE = {
    "enabled": True,
    "documentTarget": {
        "provider": "qwen_local",
        "model": "qwen3.8-27b",
        "label": "本地推理/Qwen3.8 27B",
    },
    "documentExtensions": [".pdf", ".docx", ".pptx", ".xlsx"],
    "imageStrategy": "vision-fallback",
    "visionFallback": {"provider": "qwen_local", "model": "qwen3.8-27b", "label": "本地推理"},
    "maxRenderedPages": 20,
}


def test_reads_a_well_formed_snapshot():
    policy = read_policy(WIRE)
    assert policy.enabled is True
    assert policy.document_target == QWEN
    assert policy.max_rendered_pages == 20
    assert policy.image_strategy == "vision-fallback"


@pytest.mark.parametrize("raw", [None, 42, "on", [], {}, {"enabled": "yes"}, {"enabled": False}])
def test_defaults_to_off_for_anything_unrecognised(raw):
    """默认关。配歪了当启用，会把会话锁死在一个取不到的模型上。"""
    assert read_policy(raw if raw is not None else {}) == ROUTING_OFF


def test_refuses_to_enable_without_a_usable_target():
    assert read_policy({**WIRE, "documentTarget": None}) == ROUTING_OFF
    assert read_policy({**WIRE, "documentTarget": {"provider": "", "model": "m"}}) == ROUTING_OFF


def test_refuses_to_enable_with_no_usable_extensions():
    assert read_policy({**WIRE, "documentExtensions": []}) == ROUTING_OFF
    assert read_policy({**WIRE, "documentExtensions": ["pdf", "", 7]}) == ROUTING_OFF


def test_page_cap_falls_back_when_nonsense():
    assert read_policy({**WIRE, "maxRenderedPages": 0}).max_rendered_pages == 20
    assert read_policy({**WIRE, "maxRenderedPages": "x"}).max_rendered_pages == 20
    assert read_policy({**WIRE, "maxRenderedPages": 5}).max_rendered_pages == 5


def test_accepts_snake_case_too():
    """Desktop 写配置时可能按 YAML 习惯落成 snake_case。"""
    snake = {
        "enabled": True,
        "document_target": WIRE["documentTarget"],
        "document_extensions": [".pdf"],
        "max_rendered_pages": 7,
    }
    policy = read_policy(snake)
    assert policy.enabled and policy.document_target == QWEN and policy.max_rendered_pages == 7


def test_matches_documents_by_extension_across_separators():
    policy = read_policy(WIRE)
    assert has_routed_document(["年报.PDF"], policy)
    assert has_routed_document(["C:\\Users\\a\\季报.DOCX"], policy)
    assert has_routed_document(["/tmp/deck.pptx"], policy)


def test_images_do_not_trigger_a_lock():
    """图片走 vision_fallback，不锁会话模型——截图是高频动作，切一次整段缓存就废了。"""
    policy = read_policy(WIRE)
    assert not has_routed_document(["shot.png", "photo.JPG", "a.webp"], policy)


def test_names_without_extension_are_ignored():
    policy = read_policy(WIRE)
    assert not has_routed_document(["README", "", ".", "trailing."], policy)


def test_decide_locks_and_announces_the_first_time():
    policy = read_policy(WIRE)
    decision = decide(policy=policy, filenames=["年报.pdf"], locked_target=None)
    assert decision.action == "lock"
    assert decision.target == QWEN
    assert decision.announce is True


def test_decide_stays_locked_without_announcing_again():
    policy = read_policy(WIRE)
    decision = decide(policy=policy, filenames=[], locked_target=QWEN)
    assert decision.action == "lock" and decision.announce is False


def test_decide_follows_the_currently_delivered_target():
    """管理员换了私有模型之后，老会话下一轮跟着走，不卡在下线的模型上。"""
    swapped = read_policy(
        {**WIRE, "documentTarget": {"provider": "qwen_local", "model": "qwen4-32b", "label": "新"}}
    )
    decision = decide(policy=swapped, filenames=[], locked_target=QWEN)
    assert decision.target is not None and decision.target.model == "qwen4-32b"


def test_decide_is_inert_while_routing_is_off():
    decision = decide(policy=ROUTING_OFF, filenames=["年报.pdf"], locked_target=QWEN)
    assert decision.action == "none"


def test_session_lock_round_trip():
    class _S:
        pass

    session = _S()
    assert session_locked_target(session) is None
    remember_lock(session, QWEN)
    assert session_locked_target(session) == QWEN


def test_lock_reason_names_the_model_and_where_data_stays():
    reason = lock_reason(QWEN)
    assert QWEN.label in reason and "私有部署" in reason


def test_project_local_config_cannot_override_the_policy(tmp_path, monkeypatch):
    """策略只从全局用户配置读。

    走 ConfigManager.get_value() 的话，项目目录里放一份 {"enabled": false} 就能把附件
    送回公网模型——和企业 PAT / portal origin 同一条纪律。
    """
    import yaml

    from agenticx.cli.config_manager import ConfigManager

    global_path = tmp_path / "global.yaml"
    global_path.write_text(
        yaml.safe_dump({"enterprise": {"attachment_routing": WIRE}}, allow_unicode=True),
        encoding="utf-8",
    )
    # _load_yaml 收的是 Path，不是 str。
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", global_path, raising=False)

    def _boom(*_args, **_kwargs):
        raise AssertionError("policy must not be read through get_value()")

    monkeypatch.setattr(ConfigManager, "get_value", staticmethod(_boom), raising=False)
    assert read_policy().document_target == QWEN


class _Session:
    def __init__(self, provider="zhipu", model="glm-5.2", window=128000):
        self.provider_name = provider
        self.model_name = model
        self.declared_context_window = window


def test_apply_switches_the_session_and_clears_the_declared_window():
    session = _Session()
    decision = apply_to_session(session, filenames=["年报.pdf"], policy=read_policy(WIRE))
    assert decision is not None and decision.announce is True
    assert (session.provider_name, session.model_name) == (QWEN.provider, QWEN.model)
    # declared_context_window 是跟客户端选的模型一起传上来的，换了模型就是错的。
    assert session.declared_context_window is None


def test_apply_is_a_noop_for_images():
    session = _Session()
    assert apply_to_session(session, filenames=["shot.png"], policy=read_policy(WIRE)) is None
    assert (session.provider_name, session.model_name) == ("zhipu", "glm-5.2")
    assert session.declared_context_window == 128000


def test_apply_stays_locked_on_later_turns_without_attachments():
    policy = read_policy(WIRE)
    session = _Session()
    apply_to_session(session, filenames=["年报.pdf"], policy=policy)
    session.provider_name, session.model_name = "zhipu", "glm-5.2"  # 客户端又传了旧模型
    decision = apply_to_session(session, filenames=[], policy=policy)
    assert decision is not None and decision.announce is False
    assert (session.provider_name, session.model_name) == (QWEN.provider, QWEN.model)


def test_apply_does_nothing_while_routing_is_off():
    session = _Session()
    assert apply_to_session(session, filenames=["年报.pdf"], policy=ROUTING_OFF) is None
    assert session.provider_name == "zhipu"


def test_enterprise_sessions_are_addressed_by_full_id():
    """Desktop 企业登录后所有模型挂在单一 enterprise provider 下，模型名就是全 id。

    按 provider/model 寻址会切到一个不存在的模型。
    """
    policy = read_policy(WIRE)
    session = _Session(provider="enterprise", model="zhipu/glm-5.2")
    apply_to_session(session, filenames=["年报.pdf"], policy=policy)
    assert session.provider_name == "enterprise"
    assert session.model_name == "qwen_local/qwen3.8-27b"


def test_direct_sessions_are_addressed_by_provider_and_model():
    policy = read_policy(WIRE)
    session = _Session(provider="zhipu", model="glm-5.2")
    apply_to_session(session, filenames=["年报.pdf"], policy=policy)
    assert (session.provider_name, session.model_name) == ("qwen_local", "qwen3.8-27b")


def test_ref_id_defaults_to_provider_slash_model():
    """服务端漏发 id 时自己拼一个，而不是留空导致企业会话切到 ""。"""
    policy = read_policy(WIRE)
    assert policy.document_target is not None
    assert policy.document_target.id == "qwen_local/qwen3.8-27b"
