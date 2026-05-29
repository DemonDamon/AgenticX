#!/usr/bin/env python3
"""Host-side client for the in-workspace MCP gateway.

Mirrors AgentScope's ``GatewayClient`` host-side facade: it talks to the
container-side gateway over HTTP (``/health``, ``/mcps``,
``/mcps/{name}/tools``, ``/mcps/{name}/tools/{tool}``). An ``httpx.AsyncClient``
may be injected so the same client can be driven over an in-process ASGI
transport in tests (no Docker required).

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx


class GatewayToolError(Exception):
    """Raised when a gateway tool call fails at the protocol level."""


def _bearer_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


class GatewayClient:
    """Workspace-side facade over the in-container MCP gateway."""

    def __init__(
        self,
        base_url: str = "http://gateway",
        token: str = "",
        *,
        http: Optional[httpx.AsyncClient] = None,
        timeout: float | None = 30.0,
    ) -> None:
        """Build a gateway client.

        Args:
            base_url: Host-visible gateway base URL. Trailing slash stripped.
            token: Bearer token sent on every authed request.
            http: Optional shared/injected ``httpx.AsyncClient``. When provided
                (e.g. with an ASGI transport for tests) it is reused and not
                closed by this client; otherwise a one-shot client is created
                per call.
            timeout: Per-call timeout when ``http`` is not injected.
        """
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._http = http
        self._timeout = timeout

    def _client(self) -> tuple[httpx.AsyncClient, bool]:
        """Return (client, owns) — owns=True means caller must close it."""
        if self._http is not None:
            return self._http, False
        return httpx.AsyncClient(timeout=self._timeout), True

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        auth: bool = True,
    ) -> httpx.Response:
        client, owns = self._client()
        headers = _bearer_headers(self.token) if auth else {}
        url = f"{self.base_url}{path}"
        try:
            resp = await client.request(method, url, json=json, headers=headers)
        finally:
            if owns:
                await client.aclose()
        return resp

    async def health(self) -> bool:
        """Probe ``/health`` (used to wait for readiness)."""
        try:
            resp = await self._request("GET", "/health", auth=False)
        except Exception:
            return False
        return resp.status_code == 200

    async def list_mcps(self) -> List[Dict[str, Any]]:
        """List registered MCP servers."""
        resp = await self._request("GET", "/mcps")
        resp.raise_for_status()
        return list(resp.json())

    async def add_mcp(self, spec: Dict[str, Any]) -> None:
        """Register an upstream MCP server.

        Raises:
            GatewayToolError: On a non-2xx response.
        """
        resp = await self._request("POST", "/mcps", json=spec)
        if resp.status_code >= 400:
            raise GatewayToolError(_safe_detail(resp))

    async def remove_mcp(self, name: str) -> None:
        """Deregister an upstream MCP server.

        Raises:
            GatewayToolError: On a non-2xx response.
        """
        resp = await self._request("DELETE", f"/mcps/{name}")
        if resp.status_code >= 400:
            raise GatewayToolError(_safe_detail(resp))

    async def list_tools(self, name: str) -> List[Dict[str, Any]]:
        """List the upstream tool schemas for a server."""
        resp = await self._request("GET", f"/mcps/{name}/tools")
        resp.raise_for_status()
        return list(resp.json())

    async def call_tool(
        self,
        name: str,
        tool: str,
        arguments: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Invoke an upstream tool through the gateway.

        Returns:
            The reconstructed chunk dict. A 4xx/5xx response is surfaced as a
            ``{"state": "error", ...}`` chunk so the agent loop can reason
            about the failure instead of crashing.
        """
        resp = await self._request(
            "POST",
            f"/mcps/{name}/tools/{tool}",
            json={"arguments": arguments or {}},
        )
        if resp.status_code >= 400:
            detail = _safe_detail(resp)
            return {
                "content": [{"type": "text", "text": detail}],
                "state": "error",
            }
        payload = resp.json()
        chunk = payload.get("chunk")
        if chunk is None:
            raise GatewayToolError(
                f"gateway returned no chunk for {name}/{tool}",
            )
        return chunk


def _safe_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except Exception:
        return f"HTTP {resp.status_code}: {resp.text[:200]}"
    if isinstance(body, dict) and "detail" in body:
        return f"HTTP {resp.status_code}: {body['detail']}"
    return f"HTTP {resp.status_code}: {str(body)[:200]}"
