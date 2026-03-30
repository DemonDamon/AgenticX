#!/usr/bin/env python3
"""Unified gateway message models for IM adapters and device relay.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, Field


class GatewayAttachment(BaseModel):
    """Optional attachment metadata from an IM platform."""

    name: str = ""
    url: str = ""
    mime_type: str = ""
    extra: dict[str, Any] = Field(default_factory=dict)


class GatewayMessage(BaseModel):
    """Normalized inbound message from any IM adapter."""

    message_id: str = ""
    source: str = ""  # feishu | wecom | dingtalk | siri
    sender_id: str = ""
    sender_name: str = ""
    content: str = ""
    content_type: str = "text"  # text | image | file | voice
    attachments: List[GatewayAttachment] = Field(default_factory=list)
    timestamp: float = 0.0
    raw: dict[str, Any] = Field(default_factory=dict)
    device_id: str = ""
    chat_id: str = ""  # Feishu open_chat_id etc., for threaded reply


class GatewayReply(BaseModel):
    """Outbound reply to be delivered by the source adapter."""

    message_id: str = ""
    source: str = ""
    reply_to_sender_id: str = ""
    chat_id: str = ""
    content: str = ""
    content_type: str = "text"
    attachments: List[GatewayAttachment] = Field(default_factory=list)


class PendingMessage(BaseModel):
    """Queued message when device is offline."""

    message: GatewayMessage
    enqueued_at: float = 0.0
