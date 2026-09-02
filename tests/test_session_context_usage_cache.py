#!/usr/bin/env python3
"""Session context-usage API cache payload (per-session last row + totals).

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.runtime.usage_store import UsageStore
from agenticx.studio.context_usage import (
    _reset_usage_caches,
    _text_tokens,
    estimate_session_context_usage,
    load_session_cache_payload,
)


def test_text_tokens_counts_cjk_denser_than_latin() -> None:
    """A flat chars/4 ratio undercounts Chinese by ~40%; CJK is ~1 char/token."""
    assert _text_tokens("") == 0
    # 100 CJK chars must land far above the old 100 // 4 == 25.
    assert 70 <= _text_tokens("你" * 100) <= 90
    # Latin stays in the historical band.
    assert 25 <= _text_tokens("a" * 100) <= 35
    # Mixed text sits between the two pure cases.
    mixed = "你" * 50 + "a" * 50
    assert _text_tokens("a" * 100) < _text_tokens(mixed) < _text_tokens("你" * 100)


def test_text_tokens_is_monotonic_and_never_zero_for_content() -> None:
    assert _text_tokens("x") >= 1
    assert _text_tokens("你好") >= 1
    assert _text_tokens("你" * 200) > _text_tokens("你" * 100)


def test_load_session_cache_payload_reads_session_totals(tmp_path, monkeypatch) -> None:
    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    store.record_sync(
        session_id="sid-a",
        avatar_id="",
        provider="kimi",
        model="kimi-k2.6",
        input_tokens=1000,
        output_tokens=10,
        cached_tokens=400,
        reasoning_tokens=0,
        total_tokens=1010,
    )
    monkeypatch.setattr("agenticx.runtime.usage_store.get_usage_store", lambda: store)
    payload = load_session_cache_payload("sid-a")
    assert payload["session_input_tokens"] == 1000
    assert payload["session_cached_tokens"] == 400
    assert abs(float(payload["session_cache_ratio"]) - 0.4) < 1e-9
    assert payload["last_cached_tokens"] == 400
    assert payload["last_input_tokens"] == 1000
    assert payload["requests"] == 1


def test_load_session_cache_payload_unknown_session_is_zeros(tmp_path, monkeypatch) -> None:
    store = UsageStore(db_path=tmp_path / "usage.sqlite")
    monkeypatch.setattr("agenticx.runtime.usage_store.get_usage_store", lambda: store)
    payload = load_session_cache_payload("missing-session")
    assert payload["session_input_tokens"] == 0
    assert payload["session_cached_tokens"] == 0
    assert payload["session_cache_ratio"] == 0.0
    assert payload["last_input_tokens"] == 0
    assert payload["last_cached_tokens"] == 0
    assert payload["requests"] == 0
    assert payload["zero_cache_requests"] == 0


def _empty_managed(session_id: str = "sid-test"):
    session = SimpleNamespace(
        session_id=session_id,
        model_name="",
        bound_avatar_id=None,
        kb_retrieval_mode="",
        agent_messages=[],
        mcp_hub=None,
        mcp_configs={},
        connected_servers=set(),
        chat_history=[],
        scratchpad={},
        todo_manager=None,
    )
    return SimpleNamespace(studio_session=session, taskspaces=[])


def test_estimate_uses_override_model_for_window(monkeypatch) -> None:
    _reset_usage_caches()
    monkeypatch.setattr(
        "agenticx.studio.context_usage.get_all_skill_summaries",
        lambda bound_avatar_id=None: [],
    )
    monkeypatch.setattr(
        "agenticx.studio.context_usage._build_workspace_context_block",
        lambda *args, **kwargs: "",
    )
    managed = _empty_managed()
    assert estimate_session_context_usage(managed, session_id="sid-test")["max_tokens"] == 128_000
    assert (
        estimate_session_context_usage(managed, session_id="sid-test", model_name="MiniMax-M2.7")[
            "max_tokens"
        ]
        == 192_000
    )
    assert (
        estimate_session_context_usage(managed, session_id="sid-test", model_name="glm-5.2")[
            "max_tokens"
        ]
        == 1_000_000
    )
    managed.studio_session.model_name = "glm-5.2"
    assert (
        estimate_session_context_usage(managed, session_id="sid-test", model_name="MiniMax-M2.7")[
            "max_tokens"
        ]
        == 192_000
    )


def test_estimate_reuses_occupancy_cache_without_rescan(monkeypatch) -> None:
    _reset_usage_caches()
    calls = {"skills": 0}

    def _skills(**_kwargs):
        calls["skills"] += 1
        return []

    monkeypatch.setattr("agenticx.studio.context_usage.get_all_skill_summaries", _skills)
    monkeypatch.setattr(
        "agenticx.studio.context_usage._build_workspace_context_block",
        lambda *args, **kwargs: "",
    )
    managed = _empty_managed("sid-cache")
    first = estimate_session_context_usage(managed, session_id="sid-cache")
    second = estimate_session_context_usage(
        managed, session_id="sid-cache", model_name="glm-5.2"
    )
    assert calls["skills"] == 1
    assert first["categories"] == second["categories"]
    assert second["max_tokens"] == 1_000_000


def test_estimate_ignores_inline_attachment_data_urls(monkeypatch) -> None:
    """Occupancy must track model-facing text, not persisted image payloads."""
    _reset_usage_caches()
    monkeypatch.setattr(
        "agenticx.studio.context_usage.get_all_skill_summaries",
        lambda bound_avatar_id=None: [],
    )
    monkeypatch.setattr(
        "agenticx.studio.context_usage._build_workspace_context_block",
        lambda *args, **kwargs: "",
    )
    huge_data_url = "data:image/png;base64," + ("A" * 400_000)
    managed = _empty_managed("sid-image")
    managed.studio_session.agent_messages = [
        {
            "role": "user",
            "content": "我加入了这个计划有什么帮助吗？",
            "attachments": [
                {
                    "name": "image.png",
                    "mime_type": "image/png",
                    "size": 338366,
                    "data_url": huge_data_url,
                }
            ],
        }
    ]
    usage = estimate_session_context_usage(managed, session_id="sid-image")
    assert usage["categories"]["messages"] < 2_000
    assert usage["used_tokens"] < 40_000


def test_estimate_does_not_rebuild_live_system_prompt(monkeypatch) -> None:
    _reset_usage_caches()
    monkeypatch.setattr(
        "agenticx.studio.context_usage.get_all_skill_summaries",
        lambda bound_avatar_id=None: [],
    )
    monkeypatch.setattr(
        "agenticx.studio.context_usage._build_workspace_context_block",
        lambda *args, **kwargs: "",
    )

    def _boom(*_args, **_kwargs):
        raise AssertionError("must not rebuild the live system prompt")

    monkeypatch.setattr(
        "agenticx.runtime.prompts.meta_agent.build_meta_agent_system_prompt",
        _boom,
    )
    monkeypatch.setattr(
        "agenticx.runtime.prompts.meta_agent._build_memory_recall_context",
        _boom,
    )
    estimate_session_context_usage(_empty_managed("sid-fast"), session_id="sid-fast")


def test_context_usage_api_uses_model_query_for_window(monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from agenticx.studio.server import create_studio_app

    monkeypatch.delenv("AGX_DESKTOP_TOKEN", raising=False)
    app = create_studio_app()
    client = TestClient(app)
    created = client.get("/api/session")
    assert created.status_code == 200
    sid = created.json()["session_id"]
    assert client.get("/api/avatars").status_code == 200
    assert client.get("/api/sessions").status_code == 200

    empty = client.get("/api/session/context_usage", params={"session_id": sid})
    assert empty.status_code == 200
    assert empty.json()["session_id"] == sid
    assert empty.json()["max_tokens"] == 128_000

    glm = client.get(
        "/api/session/context_usage",
        params={"session_id": sid, "model": "glm-5.2"},
    )
    assert glm.status_code == 200
    assert glm.json()["session_id"] == sid
    assert glm.json()["model"] == "glm-5.2"
    assert glm.json()["max_tokens"] == 1_000_000

    mm = client.get(
        "/api/session/context_usage",
        params={"session_id": sid, "model": "MiniMax-M2.7"},
    )
    assert mm.status_code == 200
    assert mm.json()["session_id"] == sid
    assert mm.json()["model"] == "MiniMax-M2.7"
    assert mm.json()["max_tokens"] == 192_000
