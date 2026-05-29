#!/usr/bin/env python3
"""Container-side MCP gateway FastAPI app.

Mirrors AgentScope's ``_mcp_gateway_app.py`` endpoint surface but decouples the
upstream MCP machinery behind an ``MCPBackend`` protocol so the same app can
front AGX's ``MCPHub`` in production or an in-memory backend in tests.

Endpoints::

    GET    /health                            # liveness, no auth
    GET    /mcps                              # [{name, connected}, ...]
    POST   /mcps           {name, ...spec}    # register an upstream MCP
    DELETE /mcps/{name}                       # deregister
    GET    /mcps/{name}/tools                 # [tool schema, ...]
    POST   /mcps/{name}/tools/{tool}          # {arguments: {...}} -> {chunk}

Auth: every endpoint except ``/health`` requires
``Authorization: Bearer <token>`` when a token is configured (empty token
disables auth for backward compatibility).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Dict, List, Protocol, runtime_checkable

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse


@runtime_checkable
class MCPBackend(Protocol):
    """Abstract upstream MCP machinery the gateway forwards to.

    A production implementation wraps AGX's ``MCPHub``; the bundled
    ``InMemoryMCPBackend`` is enough for tests and local demos.
    """

    async def add(self, spec: Dict[str, Any]) -> None:
        """Register (and connect, if stateful) an upstream MCP server."""
        ...

    async def remove(self, name: str) -> None:
        """Deregister an upstream MCP server."""
        ...

    async def list_servers(self) -> List[Dict[str, Any]]:
        """List registered servers as ``{name, connected}`` dicts."""
        ...

    async def list_tools(self, name: str) -> List[Dict[str, Any]]:
        """List the upstream tool schemas for a server."""
        ...

    async def call_tool(
        self,
        name: str,
        tool: str,
        arguments: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Invoke an upstream tool, returning a chunk dict.

        Raises:
            KeyError: When the server or tool does not exist.
        """
        ...


class InMemoryMCPBackend:
    """A backend backed by plain Python callables. Test/demo oriented.

    Each registered server provides a mapping of ``tool_name -> handler`` where
    ``handler(arguments: dict) -> Any``. Handlers may be sync or async.
    """

    def __init__(self) -> None:
        self._servers: Dict[str, Dict[str, Any]] = {}

    def register_server(
        self,
        name: str,
        tools: Dict[str, Callable[[Dict[str, Any]], Any]],
        *,
        schemas: Dict[str, Dict[str, Any]] | None = None,
    ) -> None:
        """Pre-register a server with tool handlers (bypasses HTTP add)."""
        self._servers[name] = {
            "handlers": dict(tools),
            "schemas": dict(schemas or {}),
        }

    async def add(self, spec: Dict[str, Any]) -> None:
        name = str(spec.get("name", "")).strip()
        if not name:
            raise KeyError("name required")
        self._servers.setdefault(
            name,
            {"handlers": {}, "schemas": {}},
        )

    async def remove(self, name: str) -> None:
        if name not in self._servers:
            raise KeyError(name)
        del self._servers[name]

    async def list_servers(self) -> List[Dict[str, Any]]:
        return [{"name": n, "connected": True} for n in self._servers]

    async def list_tools(self, name: str) -> List[Dict[str, Any]]:
        srv = self._servers.get(name)
        if srv is None:
            raise KeyError(name)
        out: List[Dict[str, Any]] = []
        for tool_name in srv["handlers"]:
            schema = srv["schemas"].get(tool_name) or {
                "type": "object",
                "properties": {},
            }
            out.append({"name": tool_name, "inputSchema": schema})
        return out

    async def call_tool(
        self,
        name: str,
        tool: str,
        arguments: Dict[str, Any],
    ) -> Dict[str, Any]:
        srv = self._servers.get(name)
        if srv is None:
            raise KeyError(name)
        handler = srv["handlers"].get(tool)
        if handler is None:
            raise KeyError(tool)
        result = handler(arguments)
        if asyncio.iscoroutine(result):
            result = await result
        return {
            "content": [{"type": "text", "text": str(result)}],
            "state": "success",
        }


class GatewayState:
    """Holds the gateway's auth token and backend."""

    def __init__(self, backend: MCPBackend, token: str = "") -> None:
        self.backend = backend
        self.token = token or ""


def _make_auth_dep(state: GatewayState) -> Callable[[Request], Awaitable[None]]:
    async def _auth(request: Request) -> None:
        if not state.token:
            return
        header = request.headers.get("authorization", "")
        if header != f"Bearer {state.token}":
            raise HTTPException(status_code=401, detail="unauthorized")

    return _auth


def build_gateway_app(state: GatewayState) -> FastAPI:
    """Build the gateway FastAPI app wired against ``state``."""
    app = FastAPI(title="agenticx-workspace-mcp-gateway")
    auth = Depends(_make_auth_dep(state))

    @app.get("/health")
    async def _health() -> PlainTextResponse:
        return PlainTextResponse("ok")

    @app.get("/mcps", dependencies=[auth])
    async def _list_mcps() -> List[Dict[str, Any]]:
        return await state.backend.list_servers()

    @app.post("/mcps", dependencies=[auth])
    async def _add_mcp(request: Request) -> Dict[str, Any]:
        body = await request.json()
        name = str(body.get("name", "")).strip()
        if not name:
            raise HTTPException(400, "name required")
        try:
            await state.backend.add(body)
        except KeyError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, f"add failed: {exc}") from exc
        return {"ok": True}

    @app.delete("/mcps/{name}", dependencies=[auth])
    async def _remove_mcp(name: str) -> Dict[str, Any]:
        try:
            await state.backend.remove(name)
        except KeyError as exc:
            raise HTTPException(404, f"{name!r} not found") from exc
        return {"ok": True}

    @app.get("/mcps/{name}/tools", dependencies=[auth])
    async def _list_tools(name: str) -> List[Dict[str, Any]]:
        try:
            return await state.backend.list_tools(name)
        except KeyError as exc:
            raise HTTPException(404, f"{name!r} not found") from exc

    @app.post("/mcps/{name}/tools/{tool}", dependencies=[auth])
    async def _call_tool(
        name: str,
        tool: str,
        request: Request,
    ) -> Dict[str, Any]:
        body = await request.json()
        arguments = body.get("arguments") or {}
        try:
            chunk = await state.backend.call_tool(name, tool, arguments)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(500, str(exc)) from exc
        return {"chunk": chunk}

    return app
