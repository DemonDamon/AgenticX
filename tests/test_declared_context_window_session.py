"""Declared context window must never outlive the model it was declared for."""
from agenticx.cli.studio import StudioSession


class _FakeManaged:
    def __init__(self, session):
        self.studio_session = session
        self.updated_at = 0.0


def _manager_with(session):
    from agenticx.studio.session_manager import SessionManager
    mgr = object.__new__(SessionManager)
    managed = _FakeManaged(session)
    mgr.get = lambda sid, touch=True: managed  # type: ignore[method-assign]
    mgr._persist_session_state = lambda sid, sess: None  # type: ignore[method-assign]
    return mgr


def test_model_switch_drops_declared_window():
    s = StudioSession(provider_name="enterprise", model_name="zhipu/glm-5.2")
    s.declared_context_window = 128_000
    mgr = _manager_with(s)
    assert mgr.set_session_model("sid", provider="enterprise", model="zhipu/glm-5.1") is True
    assert s.declared_context_window is None


def test_same_model_keeps_declared_window():
    s = StudioSession(provider_name="enterprise", model_name="zhipu/glm-5.2")
    s.declared_context_window = 128_000
    mgr = _manager_with(s)
    assert mgr.set_session_model("sid", provider="enterprise", model="zhipu/glm-5.2") is True
    assert s.declared_context_window == 128_000


class _Session:
    def __init__(self, provider="custom_openai_local", model="glm-5.2", declared=None):
        self.provider_name = provider
        self.model_name = model
        self.declared_context_window = declared


def _stub_config(monkeypatch, table):
    from agenticx.cli import config_manager

    monkeypatch.setattr(
        config_manager.ConfigManager,
        "get_value",
        classmethod(lambda cls, key: table if key == "runtime.model_context_windows" else None),
    )


def test_local_override_applies_when_no_admin_declaration(monkeypatch):
    """自配置厂商没有企业目录，开发者菜单是它唯一的声明入口。"""
    from agenticx.runtime.model_context_window import (
        declared_window_for_session,
        resolve_context_window,
    )

    _stub_config(monkeypatch, {"custom_openai_local/glm-5.2": 128_000})
    session = _Session()
    assert declared_window_for_session(session) == 128_000
    # 没有覆盖时表里的 1M 缩放后仍是 250K，远高于这个端点实际能吃的 128K。
    assert resolve_context_window("glm-5.2") == 250_000
    assert resolve_context_window("glm-5.2", declared_window_for_session(session)) == 128_000


def test_admin_declaration_wins_over_local_override(monkeypatch):
    """企业已统一管理的模型，本机改不动。"""
    from agenticx.runtime.model_context_window import declared_window_for_session

    _stub_config(monkeypatch, {"enterprise/zhipu/glm-5.2": 64_000})
    session = _Session(provider="enterprise", model="zhipu/glm-5.2", declared=200_000)
    assert declared_window_for_session(session) == 200_000


def test_local_override_ignores_unusable_and_missing_entries(monkeypatch):
    from agenticx.runtime.model_context_window import declared_window_for_session

    _stub_config(monkeypatch, {"custom_openai_local/glm-5.2": 50})
    assert declared_window_for_session(_Session()) is None

    _stub_config(monkeypatch, {"other/model": 128_000})
    assert declared_window_for_session(_Session()) is None

    _stub_config(monkeypatch, "not-a-table")
    assert declared_window_for_session(_Session()) is None


def test_config_read_failure_never_fabricates_a_window(monkeypatch):
    """配置读不出来时必须当作『没配』，不能冒充一个窗口值。"""
    from agenticx.cli import config_manager
    from agenticx.runtime.model_context_window import declared_window_for_session

    def _boom(cls, key):
        raise OSError("config unreadable")

    monkeypatch.setattr(config_manager.ConfigManager, "get_value", classmethod(_boom))
    assert declared_window_for_session(_Session()) is None


def _stub_providers(monkeypatch, providers, windows):
    from agenticx.cli import config_manager

    def _get(cls, key):
        if key == "providers":
            return providers
        if key == "runtime.model_context_windows":
            return windows
        return None

    monkeypatch.setattr(config_manager.ConfigManager, "get_value", classmethod(_get))


def test_managed_provider_ignores_local_override_entirely(monkeypatch):
    """企业统一管理的模型，本机那张表一律不生效——哪怕管理员那边留空。"""
    from agenticx.runtime.model_context_window import declared_window_for_session

    _stub_providers(
        monkeypatch,
        {"enterprise": {"managed": True}},
        {"enterprise/zhipu/glm-5.2": 64_000},
    )
    session = _Session(provider="enterprise", model="zhipu/glm-5.2")
    # 管理员未声明：不回落到登录前留下的本机值。
    assert declared_window_for_session(session) is None
    # 管理员声明了：以管理员为准。
    session.declared_context_window = 200_000
    assert declared_window_for_session(session) == 200_000


def test_self_configured_provider_still_uses_local_override(monkeypatch):
    """自配置厂商没有企业目录，本机覆盖仍是它唯一的声明入口。"""
    from agenticx.runtime.model_context_window import declared_window_for_session

    _stub_providers(
        monkeypatch,
        {"custom_openai_local": {"managed": False}, "enterprise": {"managed": True}},
        {"custom_openai_local/glm-5.2": 128_000},
    )
    assert declared_window_for_session(_Session()) == 128_000
