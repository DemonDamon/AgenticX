#!/usr/bin/env python3
"""IM adapter protocol for webhook ingest and outbound replies.

Author: Damon Li
"""

from __future__ import annotations

from typing import Optional, Protocol

from fastapi import Request, Response

from agenticx.gateway.models import GatewayMessage, GatewayReply


class IMAdapter(Protocol):
    platform: str

    async def verify_webhook(self, request: Request) -> Optional[Response]:
        """Return a Response to short-circuit (e.g. URL challenge), or None to continue."""
        ...

    async def parse_message(self, request: Request) -> Optional[GatewayMessage]:
        ...

    async def send_reply(self, reply: GatewayReply) -> bool:
        ...
