#!/usr/bin/env python3
"""HTTP/SSE protocol models for Studio service adapter.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    session_id: str
    user_input: str = Field(..., min_length=1)
    provider: Optional[str] = None
    model: Optional[str] = None
    agent_id: Optional[str] = None
    mode: Optional[str] = "interactive"
    context_files: Optional[Dict[str, str]] = None


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
