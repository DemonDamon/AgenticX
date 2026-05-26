#!/usr/bin/env python3
"""Tests for pending visual attachment injection in AgentRuntime.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.cli.agent_tools import PENDING_VISUAL_ATTACHMENTS_KEY
from agenticx.cli.studio import StudioSession
from agenticx.runtime.agent_runtime import _inject_pending_visual_attachments


def test_inject_pending_visual_attachments_appends_multimodal_user_message() -> None:
    session = StudioSession()
    session.scratchpad = {
        PENDING_VISUAL_ATTACHMENTS_KEY: [
            {
                "name": "cover.png",
                "data_url": "data:image/png;base64,abc",
                "mime_type": "image/png",
                "size": 3,
                "source": "https://example.com/cover.png",
            }
        ]
    }
    messages = [{"role": "tool", "content": "done"}]
    _inject_pending_visual_attachments(session, messages, is_system_trigger=False)
    assert PENDING_VISUAL_ATTACHMENTS_KEY not in session.scratchpad
    assert messages[-1]["role"] == "user"
    content = messages[-1]["content"]
    assert isinstance(content, list)
    assert content[0]["type"] == "text"
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"] == "data:image/png;base64,abc"
    assert session.agent_messages[-1] == messages[-1]
    assert session.chat_history[-1]["visual_attachments"][0]["name"] == "cover.png"


def test_inject_pending_visual_attachments_clears_after_pop() -> None:
    session = StudioSession()
    session.scratchpad = {
        PENDING_VISUAL_ATTACHMENTS_KEY: [
            {
                "name": "a.png",
                "data_url": "data:image/png;base64,abc",
                "mime_type": "image/png",
                "size": 1,
                "source": "a",
            }
        ]
    }
    messages: list[dict] = []
    _inject_pending_visual_attachments(session, messages, is_system_trigger=True)
    assert session.scratchpad.get(PENDING_VISUAL_ATTACHMENTS_KEY) is None
    _inject_pending_visual_attachments(session, messages, is_system_trigger=True)
    assert messages == [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "<system-injected> attached images requested via view_image tool:",
                },
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
            ],
        }
    ]
