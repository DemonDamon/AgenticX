#!/usr/bin/env python3
"""Skills over MCP server: expose the local skill registry (SEP-2640).

Turns ``RegistryStorage`` entries into the ``io.modelcontextprotocol/skills``
extension surface so any capable host (Claude Code, another AgenticX
instance, ...) can discover and read skills over MCP:

- ``skills/list``  — paginated enumeration with per-entry file manifests
- ``skills/get``   — one entry by ``skill://`` URI
- ``resources/read`` — serve file bytes (``text/markdown`` et al.)
- ``resources/directory/read`` — non-recursive directory browsing
- ``resources/list`` — resources-primitive enumeration of skill files

The official SDK (``mcp<2``) does not wrap the skills extension yet, so this
module subclasses the low-level ``Server`` and teaches its session the
extended request union from :mod:`agenticx.skills.mcp_wire`. Everything
else is plain ``request_handlers`` registration.

Manifests are always computed from the stored bytes (never trusted from
caches), so the served digests can never drift from the served content.

Author: Damon Li
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel

from agenticx.skills.manifest import (
    MAX_SKILL_BYTES,
    MAX_SKILL_FILES,
    SKILLS_EXTENSION_ID,
    SkillFileEntry,
    SkillManifest,
    compute_digest,
    parse_frontmatter_from_markdown,
)
from agenticx.skills import mcp_wire
from agenticx.skills.registry import RegistrySkillEntry, RegistryStorage

logger = logging.getLogger(__name__)

try:
    import anyio  # type: ignore
    import mcp.types as mcp_types  # type: ignore
    from mcp.server.lowlevel import Server  # type: ignore
    from mcp.server.models import InitializationOptions  # type: ignore
    from mcp.server.session import ServerSession  # type: ignore
    from mcp.shared.exceptions import McpError  # type: ignore
except ImportError:  # pragma: no cover - degrade without the mcp extra
    anyio = None  # type: ignore
    mcp_types = None  # type: ignore
    Server = object  # type: ignore
    InitializationOptions = None  # type: ignore
    ServerSession = None  # type: ignore
    McpError = None  # type: ignore


# Default page size for skills/list pagination.
SKILLS_LIST_PAGE_SIZE = 100
# Advertised manifest freshness (spec allows hosts to cache manifests).
SKILLS_TTL_MS = 300_000
SKILLS_CACHE_SCOPE = "public"

# gate dict key compared by --include-gate (see RegistrySkillSource).
GATE_LEVEL_KEY = "level"

# Content types served for resources/read / resources/list (v2 multi-file).
_MIME_BY_SUFFIX: Dict[str, str] = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".py": "text/x-python",
    ".json": "application/json",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".txt": "text/plain",
    ".csv": "text/csv",
}


def _mime_for(uri: str) -> str:
    name = uri.rsplit("/", 1)[-1]
    suffix = name.rsplit(".", 1)[1].lower() if "." in name else ""
    return _MIME_BY_SUFFIX.get(f".{suffix}", "text/plain")


# ---------------------------------------------------------------------------
# Task 1: registry name <-> skill:// URI mapping
# ---------------------------------------------------------------------------

_SKILL_URI_PREFIX = "skill://"
# Same charset the registry validates skill names with.
_SKILL_NAME_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")


class SkillUrnMapper:
    """Bidirectional mapping between registry entries and ``skill://`` URIs.

    URI scheme: ``skill://<skill_name>/SKILL.md`` for the entry document and
    ``skill://<skill_name>/<relative/path>`` for support files. The URI
    segment after the scheme is the registry name (and frontmatter name).
    """

    @staticmethod
    def skill_root(name: str) -> str:
        return _SKILL_URI_PREFIX + name

    @staticmethod
    def skill_md_uri(name: str) -> str:
        return f"{_SKILL_URI_PREFIX}{name}/SKILL.md"

    @staticmethod
    def parse(uri: str) -> Optional[Tuple[str, str]]:
        """Split a ``skill://`` URI into ``(name, relative_path)``.

        The root URI ``skill://<name>`` maps to ``(name, "")``. Returns None
        for non-skill URIs, malformed names, trailing slashes, or paths that
        attempt traversal.
        """
        if not isinstance(uri, str) or not uri.startswith(_SKILL_URI_PREFIX):
            return None
        rest = uri[len(_SKILL_URI_PREFIX):]
        if not rest or rest.endswith("/") or rest.startswith("/"):
            return None
        name, _, relative = rest.partition("/")
        if not name or any(ch not in _SKILL_NAME_CHARS for ch in name):
            return None
        if relative:
            segments = relative.split("/")
            if any(seg in ("", ".", "..") for seg in segments):
                return None
        return name, relative


# ---------------------------------------------------------------------------
# Task 2: manifest source computed from stored bytes
# ---------------------------------------------------------------------------


class RegistrySkillSource:
    """Reads registry entries and computes manifests from the stored bytes.

    v2 entries (``files`` is not None, SEP-2640 governance) carry the full
    file manifest plus inline text payloads: every file is servable and the
    digests are recomputed from the stored bytes (never trusted from the
    stored ``files`` list — a drift is logged and the computed value served).
    v1 entries carry a single ``skill_content`` document; the manifest then
    lists exactly one ``SKILL.md`` resource (single-file view, no write-back).

    Entries whose size exceeds the spec limits are refused from the served
    surface (the spec SHOULD limits become MUST on our own egress).
    """

    def __init__(
        self,
        storage: RegistryStorage,
        include_gate: Optional[str] = None,
        page_size: int = SKILLS_LIST_PAGE_SIZE,
    ) -> None:
        self.storage = storage
        self.include_gate = include_gate
        self.page_size = max(1, int(page_size))
        self.mapper = SkillUrnMapper()

    # -------------------------------------------------------------- entries

    def _gate_allows(self, entry: RegistrySkillEntry) -> bool:
        if self.include_gate is None:
            return True
        return str(entry.gate.get(GATE_LEVEL_KEY, "")) == self.include_gate

    def latest_entries(self) -> List[RegistrySkillEntry]:
        """Latest version per skill name, gate-filtered, sorted by name."""
        latest: Dict[str, RegistrySkillEntry] = {}
        for entry in self.storage.list_entries():
            # list_entries sorts by (name, version, created_at, origin):
            # last wins.
            latest[entry.name] = entry
        visible = [e for e in latest.values() if self._gate_allows(e)]
        visible.sort(key=lambda e: e.name)
        return visible

    def get_latest(self, name: str) -> Optional[RegistrySkillEntry]:
        entry = self.storage.get_latest(name)
        if entry is None or not self._gate_allows(entry):
            return None
        return entry

    # ------------------------------------------------------------- manifests

    def manifest_for(self, entry: RegistrySkillEntry) -> Optional[SkillManifest]:
        """Compute the manifest for one entry, or None when not servable."""
        if entry.files is not None:
            return self._manifest_v2(entry)
        return self._manifest_v1(entry)

    def _manifest_v1(self, entry: RegistrySkillEntry) -> Optional[SkillManifest]:
        uri = self.mapper.skill_md_uri(entry.name)
        try:
            content = entry.skill_content.encode("utf-8")
        except Exception as exc:
            logger.warning("Skill %s has undecodable content, not served: %s", entry.name, exc)
            return None
        if len(content) > MAX_SKILL_BYTES:
            logger.warning(
                "Skill %s exceeds the %d-byte limit (%d bytes), not served",
                entry.name,
                MAX_SKILL_BYTES,
                len(content),
            )
            return None
        resources = [
            SkillFileEntry(uri=uri, digest=compute_digest(content), size=len(content))
        ]
        if len(resources) > MAX_SKILL_FILES:  # pragma: no cover - single file today
            logger.warning(
                "Skill %s exceeds the %d-file limit (%d files), not served",
                entry.name,
                MAX_SKILL_FILES,
                len(resources),
            )
            return None
        frontmatter = parse_frontmatter_from_markdown(entry.skill_content)
        if not isinstance(frontmatter, dict):
            frontmatter = {}
        frontmatter = dict(frontmatter)
        # The URI tail segment must equal the frontmatter name (Agent Skills
        # convention). The registry name is authoritative: it defines the URI,
        # so it overrides a drifting frontmatter value.
        frontmatter["name"] = entry.name
        return SkillManifest(
            uri=uri,
            frontmatter=frontmatter,
            resources=resources,
            resultType="complete",
            ttlMs=SKILLS_TTL_MS,
            cacheScope=SKILLS_CACHE_SCOPE,
        )

    def _manifest_v2(self, entry: RegistrySkillEntry) -> Optional[SkillManifest]:
        """Full manifest for a v2 (multi-file) registry entry."""
        uri = self.mapper.skill_md_uri(entry.name)
        contents = entry.file_contents if entry.file_contents is not None else {}
        md_text = contents.get("SKILL.md")
        if md_text is None:
            logger.warning(
                "Skill %s has a v2 manifest but no stored SKILL.md content, not served",
                entry.name,
            )
            return None
        root = self.mapper.skill_root(entry.name)
        resources: List[SkillFileEntry] = []
        total = 0
        for row in entry.files or []:
            rel = str(row.get("path", ""))
            text = contents.get(rel)
            if text is None:
                logger.warning(
                    "Skill %s is missing stored content for %r, not served",
                    entry.name,
                    rel,
                )
                return None
            raw = text.encode("utf-8")
            digest = compute_digest(raw)
            stored = str(row.get("digest", ""))
            if stored and stored != digest:
                logger.warning(
                    "Skill %s file %r digest drift (stored=%s computed=%s); "
                    "serving the computed digest",
                    entry.name,
                    rel,
                    stored,
                    digest,
                )
            total += len(raw)
            resources.append(
                SkillFileEntry(uri=f"{root}/{rel}", digest=digest, size=len(raw))
            )
        if len(resources) > MAX_SKILL_FILES:
            logger.warning(
                "Skill %s exceeds the %d-file limit (%d files), not served",
                entry.name,
                MAX_SKILL_FILES,
                len(resources),
            )
            return None
        if total > MAX_SKILL_BYTES:
            logger.warning(
                "Skill %s exceeds the %d-byte limit (%d bytes), not served",
                entry.name,
                MAX_SKILL_BYTES,
                total,
            )
            return None
        frontmatter = parse_frontmatter_from_markdown(md_text)
        if not isinstance(frontmatter, dict):
            frontmatter = {}
        frontmatter = dict(frontmatter)
        frontmatter["name"] = entry.name
        return SkillManifest(
            uri=uri,
            frontmatter=frontmatter,
            resources=resources,
            resultType="complete",
            ttlMs=SKILLS_TTL_MS,
            cacheScope=SKILLS_CACHE_SCOPE,
        )

    def manifests(self) -> List[SkillManifest]:
        out: List[SkillManifest] = []
        for entry in self.latest_entries():
            manifest = self.manifest_for(entry)
            if manifest is not None:
                out.append(manifest)
        return out

    def get_manifest(self, uri: str) -> Optional[SkillManifest]:
        parsed = SkillUrnMapper.parse(uri)
        if parsed is None:
            return None
        name, _relative = parsed
        entry = self.get_latest(name)
        if entry is None:
            return None
        return self.manifest_for(entry)

    # ---------------------------------------------------------------- bytes

    def read_file(self, uri: str) -> Optional[bytes]:
        """Serve one file's bytes (any manifest file for v2, SKILL.md for v1)."""
        parsed = SkillUrnMapper.parse(uri)
        if parsed is None:
            return None
        name, relative = parsed
        entry = self.get_latest(name)
        if entry is None:
            return None
        if entry.files is not None:
            if not relative:
                return None
            text = (entry.file_contents or {}).get(relative)
            if text is None:
                return None
            return text.encode("utf-8")
        if relative != "SKILL.md":
            return None
        try:
            return entry.skill_content.encode("utf-8")
        except Exception:  # pragma: no cover - covered by manifest_for
            return None


# ---------------------------------------------------------------------------
# Task 3: the MCP server itself
# ---------------------------------------------------------------------------


class SkillMCPServer(Server):  # type: ignore[misc, valid-type]
    """Low-level MCP server exposing the skills extension over a registry.

    The same server object can be run on any transport (stdio / streamable
    HTTP); see :func:`serve_stdio` / :func:`build_http_app`.
    """

    def __init__(
        self,
        source: RegistrySkillSource,
        name: str = "agenticx-skills",
        version: Optional[str] = None,
    ) -> None:
        if Server is object:  # pragma: no cover
            raise RuntimeError("The 'mcp' package is required for the skills server")
        super().__init__(name, version or "0.1.0")
        self.source = source
        self.request_handlers[mcp_wire.SkillsListRequest] = self._skills_list
        self.request_handlers[mcp_wire.SkillsGetRequest] = self._skills_get
        self.request_handlers[mcp_types.ReadResourceRequest] = self._read_resource
        self.request_handlers[mcp_wire.DirectoryReadRequest] = self._directory_read
        self.request_handlers[mcp_types.ListResourcesRequest] = self._list_resources

    # ----------------------------------------------------------- init result

    def create_initialization_options(self) -> Any:
        capabilities = mcp_types.ServerCapabilities(
            resources=mcp_types.ResourcesCapability(subscribe=False, listChanged=False),
            # extra="allow" carries the extension declaration.
            extensions={
                SKILLS_EXTENSION_ID: {"directoryRead": True},
            },
        )
        return InitializationOptions(
            server_name=self.name,
            server_version=self.version or "0.1.0",
            capabilities=capabilities,
            instructions=(
                "AgenticX skill registry served over the MCP skills extension. "
                "Use skills/list and skills/get to discover skills, "
                "resources/read to fetch file contents."
            ),
        )

    # ------------------------------------------------------ run with the union

    async def run(
        self,
        read_stream: Any,
        write_stream: Any,
        initialization_options: Any,
        *,
        raise_exceptions: bool = False,
        stateless: bool = False,
    ) -> None:
        """Same as the SDK ``Server.run`` but validates requests with the
        skills-extended request union (mcp_wire).

        The session's request type is swapped right after the session is
        created and before the task group starts, so no request can be
        validated against the plain union first.
        """
        import anyio  # local import keeps module import light without mcp
        from contextlib import AsyncExitStack

        async with AsyncExitStack() as stack:
            lifespan_context = await stack.enter_async_context(self.lifespan(self))
            session: ServerSession = await stack.enter_async_context(
                ServerSession(
                    read_stream,
                    write_stream,
                    initialization_options,
                    stateless=stateless,
                )
            )
            # Teach this session the skills-extended request union.
            session._receive_request_type = mcp_wire.get_extended_client_request()
            async with anyio.create_task_group() as tg:
                try:
                    async for message in session.incoming_messages:
                        tg.start_soon(
                            self._handle_message,
                            message,
                            session,
                            lifespan_context,
                            raise_exceptions,
                        )
                finally:
                    tg.cancel_scope.cancel()

    # -------------------------------------------------------------- handlers

    def _cursor_offset(self, params: Any) -> int:
        cursor = getattr(params, "cursor", None) if params is not None else None
        if not cursor:
            return 0
        try:
            offset = int(cursor)
        except (TypeError, ValueError):
            raise McpError(
                mcp_types.ErrorData(code=-32602, message=f"Invalid cursor: {cursor!r}")
            )
        if offset < 0:
            raise McpError(
                mcp_types.ErrorData(code=-32602, message=f"Invalid cursor: {cursor!r}")
            )
        return offset

    async def _skills_list(self, request: Any) -> Any:
        manifests = self.source.manifests()
        offset = self._cursor_offset(getattr(request, "params", None))
        page = manifests[offset : offset + self.source.page_size]
        next_cursor: Optional[str] = None
        if offset + len(page) < len(manifests):
            next_cursor = str(offset + len(page))
        return mcp_wire.make_server_result(
            mcp_wire.SkillsListResult(
                resultType="complete",
                skills=[self._entry_model(m) for m in page],
                nextCursor=next_cursor,
                ttlMs=SKILLS_TTL_MS,
                cacheScope=SKILLS_CACHE_SCOPE,
            )
        )

    async def _skills_get(self, request: Any) -> Any:
        uri = request.params.uri if request.params else None
        manifest = self.source.get_manifest(uri) if uri else None
        if manifest is None:
            raise McpError(
                mcp_types.ErrorData(code=-32602, message=f"Unknown skill URI: {uri!r}")
            )
        return mcp_wire.make_server_result(
            mcp_wire.SkillsGetResult(
                resultType="complete",
                skill=self._entry_model(manifest),
                ttlMs=SKILLS_TTL_MS,
                cacheScope=SKILLS_CACHE_SCOPE,
            )
        )

    async def _read_resource(self, request: Any) -> Any:
        uri = str(request.params.uri) if request.params else ""
        content = self.source.read_file(uri)
        if content is None:
            raise McpError(
                mcp_types.ErrorData(code=-32602, message=f"Unknown resource URI: {uri!r}")
            )
        text = content.decode("utf-8", errors="replace")
        return mcp_types.ReadResourceResult(
            contents=[
                mcp_types.TextResourceContents(
                    uri=uri,
                    mimeType=_mime_for(uri),
                    text=text,
                )
            ]
        )

    async def _directory_read(self, request: Any) -> Any:
        uri = request.params.uri if request.params else ""
        children = self._directory_children(uri)
        return mcp_wire.make_server_result(
            mcp_wire.DirectoryReadResult(
                resultType="complete",
                resources=children,
            )
        )

    async def _list_resources(self, request: Any) -> Any:
        manifests = self.source.manifests()
        offset = self._cursor_offset(getattr(request, "params", None))
        uris: List[str] = []
        for manifest in manifests:
            uris.extend(manifest.file_uris())
        page = uris[offset : offset + self.source.page_size]
        next_cursor = str(offset + len(page)) if offset + len(page) < len(uris) else None
        resources = [
            mcp_types.Resource(
                uri=uri,
                name=uri.rsplit("/", 1)[-1],
                mimeType=_mime_for(uri),
            )
            for uri in page
        ]
        return mcp_types.ListResourcesResult(
            resources=resources,
            nextCursor=next_cursor,
        )

    # ------------------------------------------------------------- internals

    @staticmethod
    def _entry_model(manifest: SkillManifest) -> Any:
        payload = manifest.model_dump(by_alias=True, mode="json", exclude_none=True)
        return mcp_wire.SkillEntryModel.model_validate(payload)

    def _directory_children(self, uri: str) -> List[Any]:
        """Direct children of a directory URI (non-recursive, no trailing slash)."""
        if uri.endswith("/"):
            raise McpError(
                mcp_types.ErrorData(code=-32602, message=f"Directory URI must not end with '/': {uri!r}")
            )
        parsed = SkillUrnMapper.parse(uri)
        if parsed is None:
            raise McpError(
                mcp_types.ErrorData(code=-32602, message=f"Unknown directory URI: {uri!r}")
            )
        name, relative = parsed
        manifest = self.source.get_manifest(SkillUrnMapper.skill_md_uri(name))
        if manifest is None:
            raise McpError(
                mcp_types.ErrorData(code=-32602, message=f"Unknown skill: {name!r}")
            )
        prefix = f"{SkillUrnMapper.skill_root(name)}/"
        if relative:
            prefix += relative + "/"
            known = any(u.startswith(prefix) for u in manifest.file_uris())
            if not known:
                raise McpError(
                    mcp_types.ErrorData(
                        code=-32602,
                        message=f"Unknown directory: {uri!r}",
                    )
                )
        children: Dict[str, Any] = {}
        for file_uri in manifest.file_uris():
            if not file_uri.startswith(prefix):
                continue
            tail = file_uri[len(prefix):]
            if not tail:
                continue
            first, sep, _rest = tail.partition("/")
            child_uri = prefix + first
            if sep:  # directory child
                if child_uri not in children:
                    children[child_uri] = mcp_wire.DirectoryReadResource(
                        uri=child_uri,
                        name=first,
                        mimeType="inode/directory",
                    )
            else:  # file child
                entry = manifest.find_file(file_uri)
                children[child_uri] = mcp_wire.DirectoryReadResource(
                    uri=child_uri,
                    name=first,
                    mimeType=_mime_for(child_uri),
                    size=entry.size if entry else None,
                )
        return sorted(children.values(), key=lambda r: r.uri)


# ---------------------------------------------------------------------------
# Task 4: serve entry points (stdio / streamable HTTP)
# ---------------------------------------------------------------------------


async def serve_stdio(
    source: RegistrySkillSource,
    name: str = "agenticx-skills",
) -> None:
    """Run the skills server on stdio (host-managed subprocess scenario)."""
    from mcp.server.stdio import stdio_server

    server = SkillMCPServer(source, name=name)
    options = server.create_initialization_options()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, options, raise_exceptions=True)


def build_http_app(
    source: RegistrySkillSource,
    token: Optional[str] = None,
    stateless: bool = True,
    name: str = "agenticx-skills",
) -> Any:
    """Build the streamable-HTTP ASGI app for the skills server.

    Stateless mode (protocol 2026-07-28+): any node can serve any client
    behind an arbitrary gateway, no sticky sessions. ``token`` adds a simple
    bearer check; enterprise-grade auth/audit belongs to a gateway.
    """
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
    from starlette.applications import Starlette
    from starlette.responses import JSONResponse
    from starlette.routing import Mount

    server = SkillMCPServer(source, name=name)
    session_manager = StreamableHTTPSessionManager(app=server, stateless=stateless)

    async def lifespan(app: Any) -> Any:
        async with session_manager.run():
            yield

    asgi_app = session_manager.handle_request
    if token:
        expected = f"Bearer {token}"

        class _BearerAuth:
            """Pure ASGI middleware (works on any Starlette version)."""

            def __init__(self, wrapped: Any, expected_token: str) -> None:
                self.wrapped = wrapped
                self.expected = expected_token

            async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
                if scope.get("type") == "http":
                    headers = {
                        key.decode("latin-1").lower(): value.decode("latin-1")
                        for key, value in scope.get("headers", [])
                    }
                    if headers.get("authorization") != self.expected:
                        response = JSONResponse({"error": "unauthorized"}, status_code=401)
                        await response(scope, receive, send)
                        return
                await self.wrapped(scope, receive, send)

        asgi_app = _BearerAuth(asgi_app, expected)

    return Starlette(
        routes=[Mount("/", app=asgi_app)],
        lifespan=lifespan,
    )


def run_http(
    source: RegistrySkillSource,
    host: str = "127.0.0.1",
    port: int = 8765,
    token: Optional[str] = None,
    name: str = "agenticx-skills",
) -> None:  # pragma: no cover - thin uvicorn wrapper
    """Serve the skills server over streamable HTTP via uvicorn."""
    import uvicorn

    app = build_http_app(source, token=token, name=name)
    uvicorn.run(app, host=host, port=port, log_level="info")


def _main() -> None:  # pragma: no cover - CLI wrapper (python -m agenticx.skills.mcp_server)
    """Module entry: stdio by default, streamable HTTP with --port."""
    import argparse
    import asyncio
    from pathlib import Path

    parser = argparse.ArgumentParser(
        prog="agenticx.skills.mcp_server",
        description="Expose the AgenticX skill registry over the MCP skills extension",
    )
    parser.add_argument("--registry", type=Path, default=None, help="Registry JSON path")
    parser.add_argument("--include-gate", default=None, help="Only serve entries with this gate level")
    parser.add_argument("--host", default="127.0.0.1", help="HTTP listen host")
    parser.add_argument("--port", type=int, default=None, help="Serve streamable HTTP instead of stdio")
    parser.add_argument("--token", default=None, help="Bearer token for the HTTP transport")
    args = parser.parse_args()

    storage = RegistryStorage(args.registry)
    source = RegistrySkillSource(storage, include_gate=args.include_gate)
    if args.port is None:
        asyncio.run(serve_stdio(source))
    else:
        run_http(source, host=args.host, port=args.port, token=args.token)


if __name__ == "__main__":
    _main()
