#!/usr/bin/env python3
"""HTTP/SSE protocol models for Studio service adapter.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChatImageInput(BaseModel):
    name: str
    data_url: str = Field(..., min_length=1)
    mime_type: Optional[str] = None
    size: Optional[int] = None


class ChatRequest(BaseModel):
    session_id: str
    user_input: str = Field(..., min_length=1)
    group_id: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    agent_id: Optional[str] = None
    mode: Optional[str] = "interactive"
    context_files: Optional[Dict[str, str]] = None
    image_inputs: Optional[List[ChatImageInput]] = None
    mentioned_avatar_ids: Optional[List[str]] = None
    quoted_message_id: Optional[str] = None
    quoted_content: Optional[str] = None
    # Meta-Agent display name when acting as group leader (UI bubble title, not system role text).
    meta_leader_display_name: Optional[str] = None
    # Human user's display name in group chat (shown in dialogue context; optional).
    user_display_name: Optional[str] = None
    # Global user nickname (applies to all chats, not just group). Overrides user_display_name when set.
    user_nickname: Optional[str] = None
    # Free-text user preferences/style injected into agent system prompts. Max 500 chars.
    user_preference: Optional[str] = None


class ConfirmResponse(BaseModel):
    session_id: str
    request_id: str
    approved: bool
    agent_id: str = "meta"


class SessionState(BaseModel):
    session_id: str
    provider: Optional[str] = None
    model: Optional[str] = None
    artifact_paths: List[str] = Field(default_factory=list)
    context_files: List[str] = Field(default_factory=list)
    avatar_id: Optional[str] = None
    avatar_name: Optional[str] = None


class SseEvent(BaseModel):
    type: str
    data: Dict[str, Any]
