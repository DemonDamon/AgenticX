#!/usr/bin/env python3
"""route_turn：策略本该生效却没应用上时，能不能放行。

策略层是 fail-closed（默认关、取不到目标就关），接线层原来却是 fail-open：
apply_to_session 一抛异常就放行，文档照样发给公网模型，唯一的痕迹是一行 debug 日志。
这里钉住修好之后的分工——**判断在模块里**，server.py 只把失败翻译成 HTTP。
"""

from __future__ import annotations

import pytest

from agenticx.studio import attachment_routing as ar
from agenticx.studio.attachment_routing import (
    ROUTING_OFF,
    AttachmentRoutingUnavailable,
    RoutingModelRef,
    read_policy,
    remember_lock,
    route_turn,
)

QWEN = RoutingModelRef(provider="qwen_local", model="q", label="Q", id="qwen_local/q")
WIRE = {
    "enabled": True,
    "documentTarget": {
        "provider": "qwen_local",
        "model": "q",
        "label": "Q",
        "id": "qwen_local/q",
    },
    "documentExtensions": [".pdf"],
    "maxRenderedPages": 20,
}


class _Session:
    def __init__(self):
        self.provider_name = "zhipu"
        self.model_name = "glm-5.2"
        self.declared_context_window = 128000


@pytest.fixture
def broken_apply(monkeypatch):
    def _explode(*_args, **_kwargs):
        raise RuntimeError("session object is missing an attribute")

    monkeypatch.setattr(ar, "apply_to_session", _explode)


def test_apply_failure_with_a_document_stops_the_turn(broken_apply, caplog):
    """继续往下走，文档就发给公网模型了——正是这个特性存在的理由。"""
    with caplog.at_level("WARNING", logger="agenticx.studio.attachment_routing"):
        with pytest.raises(AttachmentRoutingUnavailable):
            route_turn(_Session(), filenames=["年报.pdf"], policy=read_policy(WIRE))
    assert any("containment_required=True" in r.getMessage() for r in caplog.records)
    # 只记数量不记文件名：日志的落点和模型不是一回事。
    assert not any("年报" in r.getMessage() for r in caplog.records)


def test_apply_failure_on_an_already_locked_session_stops_too(broken_apply):
    """已锁定的会话尤其不能放行：这段历史里已经有文档内容了。

    调用方刚把客户端传来的 provider/model 落到 session 上，放行就等于回到客户端选的
    模型——本轮没带附件也一样。
    """
    session = _Session()
    remember_lock(session, QWEN)
    with pytest.raises(AttachmentRoutingUnavailable):
        route_turn(session, filenames=[], policy=read_policy(WIRE))


def test_apply_failure_without_anything_to_contain_lets_the_turn_through(broken_apply):
    """没文档、没锁定，就没有要 contain 的东西。拦掉只是白白打断对话。"""
    assert route_turn(_Session(), filenames=["shot.png"], policy=read_policy(WIRE)) is None


def test_policy_off_never_stops_a_turn(broken_apply):
    """绝大多数装机就是这种。拦掉等于把没接企业的用户全挡在门外。"""
    assert route_turn(_Session(), filenames=["年报.pdf"], policy=ROUTING_OFF) is None


def test_unreadable_policy_is_treated_as_not_configured(monkeypatch, caplog):
    def _boom():
        raise OSError("disk gone")

    monkeypatch.setattr(ar, "read_policy", _boom)
    with caplog.at_level("WARNING", logger="agenticx.studio.attachment_routing"):
        assert route_turn(_Session(), filenames=["年报.pdf"]) is None
    assert any("will not be routed" in r.getMessage() for r in caplog.records)


def test_healthy_path_still_routes():
    session = _Session()
    decision = route_turn(session, filenames=["年报.pdf"], policy=read_policy(WIRE))
    assert decision is not None and decision.announce is True
    assert (session.provider_name, session.model_name) == ("qwen_local", "q")


def test_server_delegates_instead_of_re_implementing():
    """判断抄在 server.py 里的话两边迟早会漂，而漂的方向一旦是"放行"就是泄露。"""
    from pathlib import Path

    source = Path("agenticx/studio/server.py").read_text(encoding="utf-8")
    assert "route_turn" in source
    assert "AttachmentRoutingUnavailable" in source and "status_code=503" in source
    # 旧的 fail-open 写法不能回来。
    assert 'logger.debug("attachment routing skipped"' not in source
    assert "containment_required" not in source
