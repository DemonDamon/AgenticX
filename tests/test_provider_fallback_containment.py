#!/usr/bin/env python3
"""兜底换模型不能把会话搬出它被要求待着的地方。

FALLBACK_MODELS 里全是公网厂商。原来这段代码在连续两次超时后无条件改写
session.provider_name / model_name，不看会话是不是企业托管、也不看附件路由的
sticky 锁——一份文档正因为要留在私有化部署里才被钉到私有 Qwen，私有端点超时两次
就会被整段搬去公网 DeepSeek。
"""

from __future__ import annotations

import pytest

from agenticx.runtime.provider_fallback import (
    ENTERPRISE_PROVIDER,
    FALLBACK_MODELS,
    fallback_forbidden_reason,
    maybe_apply_provider_fallback,
)


class _Session:
    def __init__(self, provider: str, model: str = "m", streak: int = 5) -> None:
        self.provider_name = provider
        self.model_name = model
        self.scratchpad = {"_llm_provider_timeout_streak": streak}


@pytest.fixture(autouse=True)
def _no_real_global_config(monkeypatch, tmp_path):
    """别读开发机上真实的 ~/.agenticx/config.yaml。"""
    from agenticx.cli.config_manager import ConfigManager

    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "config.yaml")
    return tmp_path / "config.yaml"


def _write_global(path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def test_ordinary_provider_still_falls_back():
    """守卫只针对被约束的会话，普通厂商的超时兜底照旧。"""
    session = _Session("kimi", "kimi-k2.6")
    applied, msg = maybe_apply_provider_fallback(session)
    assert applied is True
    assert session.provider_name == FALLBACK_MODELS[0]["provider"]
    assert "备用模型" in msg


def test_enterprise_session_is_never_moved_to_a_public_provider():
    """走哪个模型是管理员的决定，不是超时兜底能改的。"""
    session = _Session(ENTERPRISE_PROVIDER, "chinamobile/kimi/kimi-k3")
    assert fallback_forbidden_reason(session) == "enterprise-managed provider"
    applied, msg = maybe_apply_provider_fallback(session)
    assert applied is False and msg == ""
    # 原样不动，让上游那个真实错误浮上去，而不是被"兜底模型没有 key"盖住。
    assert (session.provider_name, session.model_name) == (
        ENTERPRISE_PROVIDER,
        "chinamobile/kimi/kimi-k3",
    )


def test_enterprise_guard_survives_logout(_no_real_global_config):
    """企业退登会把 providers.enterprise 整个删掉——实测见过：token 清空、目录归零。

    如果守卫只按配置判断，恰好在这个状态下会失效，而那正是最需要它的时刻。
    """
    _write_global(_no_real_global_config, "providers:\n  kimi:\n    enabled: true\n")
    session = _Session(ENTERPRISE_PROVIDER, "chinamobile/kimi/kimi-k3")
    assert maybe_apply_provider_fallback(session)[0] is False


def test_managed_flag_is_read_from_the_global_config_only(_no_real_global_config):
    """和附件路由同一条纪律：不走 ConfigManager.get_value()。

    这不是假想——本仓库工作目录下就有一份项目级 config，get_value("providers")
    返回的字典里根本没有 enterprise 这一项。
    """
    _write_global(
        _no_real_global_config,
        "providers:\n  vendor_x:\n    managed: true\n  vendor_y:\n    managed: false\n",
    )
    assert fallback_forbidden_reason(_Session("vendor_x")) == "enterprise-managed provider"
    assert fallback_forbidden_reason(_Session("vendor_y")) == ""


def test_attachment_routing_lock_blocks_fallback():
    """文档已经在历史里了，换家等于把正文一起搬走。"""
    from agenticx.studio.attachment_routing import LOCK_ATTR, RoutingModelRef, remember_lock

    session = _Session("custom_openai_glm", "qwen3-vl-27b")
    remember_lock(
        session,
        RoutingModelRef(id="cmccfund/qwen3", provider="cmccfund", model="qwen3", label="Qwen"),
    )
    assert getattr(session, LOCK_ATTR, None) is not None
    assert fallback_forbidden_reason(session) == "attachment-routing lock"
    assert maybe_apply_provider_fallback(session)[0] is False


def test_probe_failure_is_treated_as_forbidden(monkeypatch):
    """探测本身出错时按「禁止兜底」处理：最坏结果只是把原始错误照实报上去。"""
    import agenticx.runtime.provider_fallback as pf

    monkeypatch.setattr(
        pf, "_enterprise_managed_in_global_config", lambda _p: (_ for _ in ()).throw(OSError("boom"))
    )
    session = _Session("custom_openai_glm")
    assert fallback_forbidden_reason(session) == "containment probe failed"
    assert maybe_apply_provider_fallback(session)[0] is False
