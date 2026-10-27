#!/usr/bin/env python3
"""Feishu OpenAPI reply client. Logs status codes only.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable

import httpx

from agenticx.gateway.feishu_longconn import md_to_feishu_post

logger = logging.getLogger(__name__)

_TOKEN_INVALID = {99991663, 99991664, 99991668}


class FeishuOpenApi:
    """Tenant-token cache and a reply to the original message."""

    def __init__(
        self,
        *,
        app_id: str,
        app_secret: str,
        base_url: str,
        http: httpx.AsyncClient | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._app_id = app_id
        self._app_secret = app_secret
        self._base = base_url.rstrip("/")
        self._owns_http = http is None
        self._http = http or httpx.AsyncClient(timeout=20.0, trust_env=True)
        self._clock = clock
        self._token = ""
        self._expires_at = 0.0

    def __repr__(self) -> str:
        return f"FeishuOpenApi(app_id={self._app_id!r}, base_url={self._base!r})"

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def reply(self, *, message_id: str, text: str) -> bool:
        """Post rich text, then one plain-text attempt when Feishu rejects the post."""
        body = text[:4000]
        rich = json.dumps(md_to_feishu_post(body), ensure_ascii=False)
        if await self._post(message_id, "post", rich):
            return True
        plain = json.dumps({"text": body}, ensure_ascii=False)
        return await self._post(message_id, "text", plain)

    async def _post(self, message_id: str, msg_type: str, content: str, *, refreshed: bool = False) -> bool:
        token = await self._token_value(force=refreshed)
        if not token:
            return False
        url = f"{self._base}/open-apis/im/v1/messages/{message_id}/reply"
        try:
            response = await self._http.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                json={"msg_type": msg_type, "content": content},
            )
        except httpx.HTTPError:
            logger.warning("feishu reply transport failure")
            return False
        code = _response_code(response)
        if response.status_code == 401 or code in _TOKEN_INVALID:
            self._token = ""
            self._expires_at = 0.0
            if refreshed:
                logger.warning("feishu reply http=%s code=%s", response.status_code, code)
                return False
            return await self._post(message_id, msg_type, content, refreshed=True)
        if response.status_code >= 400 or code != 0:
            logger.warning("feishu reply http=%s code=%s", response.status_code, code)
            return False
        return True

    async def _token_value(self, *, force: bool) -> str:
        now = self._clock()
        if not force and self._token and now < self._expires_at:
            return self._token
        try:
            response = await self._http.post(
                f"{self._base}/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": self._app_id, "app_secret": self._app_secret},
            )
        except httpx.HTTPError:
            logger.warning("feishu token transport failure")
            return ""
        code = _response_code(response)
        if response.status_code >= 400 or code != 0:
            logger.warning("feishu token http=%s code=%s", response.status_code, code)
            return ""
        try:
            data = response.json()
        except ValueError:
            logger.warning("feishu token http=%s code=%s", response.status_code, code)
            return ""
        if not isinstance(data, dict):
            return ""
        token = str(data.get("tenant_access_token") or "")
        try:
            expire = int(data.get("expire") or 0)
        except (TypeError, ValueError):
            expire = 0
        self._token = token
        self._expires_at = self._clock() + max(0, expire - 60)
        return token


def _response_code(response: httpx.Response) -> int | None:
    try:
        data = response.json()
    except ValueError:
        return None
    if not isinstance(data, dict) or "code" not in data:
        return None
    try:
        return int(data["code"])
    except (TypeError, ValueError):
        return None
