#!/usr/bin/env python3
"""Device confirm RPC merges unattended parked approvals.

Author: Damon Li
"""

from __future__ import annotations

import time
from typing import Any, Dict, List

import pytest

from agenticx.gateway.client import (
    GatewayClient,
    GatewayClientSettings,
    _PENDING_CONFIRMS,
)
from agenticx.gateway.im_confirm import PendingConfirm


def _client() -> GatewayClient:
    return GatewayClient(
        GatewayClientSettings(
            enabled=True,
            gateway_ws_url="ws://127.0.0.1/ws/device/d1",
            device_id="d1",
            token="",
            studio_base_url="http://127.0.0.1:9",
            desktop_token="dtok",
        )
    )


@pytest.fixture(autouse=True)
def _clear_pending_confirms():
    _PENDING_CONFIRMS._by_sender.clear()
    yield
    _PENDING_CONFIRMS._by_sender.clear()


def _parked(request_id: str, session_id: str) -> Dict[str, Any]:
    return {
        "request_id": request_id,
        "agent_id": "meta",
        "session_id": session_id,
        "question": f"q-{request_id}",
        "created_at": 10,
        "expires_at": 99,
    }


async def test_confirm_pending_merges_parked_without_duplicate_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client()
    _PENDING_CONFIRMS.upsert(
        "mobile:inst",
        PendingConfirm(
            request_id="shared",
            agent_id="meta",
            session_id="s-store",
            question="store question",
            created_at=time.time(),
        ),
    )

    async def _fetch() -> List[Dict[str, Any]]:
        return [
            _parked("shared", "s-park-dup"),
            _parked("park-only", "s-park"),
        ]

    monkeypatch.setattr(client, "_fetch_parked_approvals", _fetch)
    rows = await client._rpc_confirm_pending({"install_id": "inst"})

    assert len(rows) == 2
    by_id = {row["request_id"]: row for row in rows}
    assert set(by_id) == {"shared", "park-only"}
    assert "source" not in by_id["shared"]
    assert by_id["park-only"]["source"] == "parked"
    assert by_id["park-only"]["session_id"] == "s-park"
    assert by_id["park-only"]["question"] == "q-park-only"
    assert by_id["park-only"]["agent_id"] == "meta"
    assert by_id["park-only"]["created_at"] == 10
    assert by_id["park-only"]["expires_at"] == 99


async def test_confirm_respond_submits_parked_item(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client()
    captured: Dict[str, Any] = {}

    async def _fetch() -> List[Dict[str, Any]]:
        return [_parked("park-1", "sess-park")]

    async def _submit(sender_key: str, pending: PendingConfirm, approved: bool) -> None:
        captured["sender_key"] = sender_key
        captured["pending"] = pending
        captured["approved"] = approved

    monkeypatch.setattr(client, "_fetch_parked_approvals", _fetch)
    monkeypatch.setattr(client, "_submit_confirm_and_remove", _submit)

    result = await client._rpc_confirm_respond(
        {"install_id": "inst", "request_id": "park-1", "approved": True}
    )

    assert captured["approved"] is True
    assert captured["pending"].session_id == "sess-park"
    assert captured["pending"].request_id == "park-1"
    assert result["ok"] is True
    assert "park-1" in result["message"]


async def test_confirm_respond_unknown_id_raises_lookup_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client()

    async def _fetch() -> List[Dict[str, Any]]:
        return [_parked("other", "s-other")]

    async def _submit(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("submit should not run")

    monkeypatch.setattr(client, "_fetch_parked_approvals", _fetch)
    monkeypatch.setattr(client, "_submit_confirm_and_remove", _submit)

    with pytest.raises(LookupError):
        await client._rpc_confirm_respond(
            {"install_id": "inst", "request_id": "missing", "approved": False}
        )


async def test_confirm_respond_empty_request_id_skips_parked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client()
    calls = {"fetch": 0}

    async def _fetch() -> List[Dict[str, Any]]:
        calls["fetch"] += 1
        return [_parked("park-1", "sess-park")]

    async def _submit(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("submit should not run")

    monkeypatch.setattr(client, "_fetch_parked_approvals", _fetch)
    monkeypatch.setattr(client, "_submit_confirm_and_remove", _submit)

    with pytest.raises(LookupError):
        await client._rpc_confirm_respond(
            {"install_id": "inst", "request_id": "", "approved": True}
        )

    assert calls["fetch"] == 0
