#!/usr/bin/env python3
"""Smoke tests for IM gateway models and user-device binding helpers.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.gateway.models import GatewayMessage, GatewayReply
from agenticx.gateway.user_device_map import UserDeviceMap


def test_gateway_message_roundtrip() -> None:
    m = GatewayMessage(
        message_id="1",
        source="feishu",
        sender_id="ou_xxx",
        sender_name="u",
        content="hello",
        device_id="d1",
    )
    raw = m.model_dump(mode="json")
    m2 = GatewayMessage.model_validate(raw)
    assert m2.content == "hello"
    assert m2.device_id == "d1"


def test_gateway_reply_json() -> None:
    r = GatewayReply(
        message_id="1",
        source="feishu",
        reply_to_sender_id="ou_xxx",
        content="ok",
    )
    assert "reply_to_sender_id" in json.loads(r.model_dump_json())


def test_user_device_map_bind(tmp_path: Path) -> None:
    p = tmp_path / "bindings.json"
    m = UserDeviceMap(p)
    assert m.try_parse_bind_command("绑定 abc123") == "abc123"
    assert m.try_parse_bind_command(" 绑定  XYZ ") == "XYZ"
    m.set_binding("feishu", "ou_1", "dev-a")
    assert m.get_device("feishu", "ou_1") == "dev-a"
