"""Tests for the Skills over MCP server (SEP-2640 server side).

Three layers:
- unit: URI mapping and manifest source computed from stored bytes
- protocol: in-process sessions (SDK memory streams) for list/get/read/directory
- transport: real stdio subprocess and streamable-HTTP round trips
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import List, Optional

import pytest

from agenticx.skills.manifest import (
    MAX_SKILL_BYTES,
    SKILLS_EXTENSION_ID,
    compute_digest,
)
from agenticx.skills import mcp_wire
from agenticx.skills.mcp_server import (
    RegistrySkillSource,
    SkillMCPServer,
    SkillUrnMapper,
    build_http_app,
)
from agenticx.skills.registry import RegistrySkillEntry, RegistryStorage


def _storage(tmp_path: Path) -> RegistryStorage:
    return RegistryStorage(tmp_path / "registry.json")


def _publish(storage: RegistryStorage, name: str, content: str, **kwargs) -> None:
    storage.publish(
        RegistrySkillEntry(
            name=name,
            version=str(kwargs.pop("version", "0.1.0")),
            description=kwargs.pop("description", ""),
            skill_content=content,
            **kwargs,
        )
    )


_SKILL_MD = "---\nname: demo\ndescription: d\n---\n\n# Demo\n\nFollow the checklist.\n"


# --------------------------------------------------------------- URI mapping


def test_urn_mapper_roundtrip() -> None:
    assert SkillUrnMapper.skill_md_uri("demo") == "skill://demo/SKILL.md"
    assert SkillUrnMapper.parse("skill://demo/SKILL.md") == ("demo", "SKILL.md")
    assert SkillUrnMapper.parse("skill://demo") == ("demo", "")
    assert SkillUrnMapper.parse("skill://demo/references/checklist.md") == (
        "demo",
        "references/checklist.md",
    )


def test_urn_mapper_rejects_malformed_uris() -> None:
    assert SkillUrnMapper.parse("file:///demo/SKILL.md") is None
    assert SkillUrnMapper.parse("skill://") is None
    assert SkillUrnMapper.parse("skill://demo/") is None  # trailing slash
    assert SkillUrnMapper.parse("skill://de mo/SKILL.md") is None  # space in name
    assert SkillUrnMapper.parse("skill://demo/../SKILL.md") is None  # traversal
    assert SkillUrnMapper.parse("skill://demo/./SKILL.md") is None
    assert SkillUrnMapper.parse("skill://demo//SKILL.md") is None


# ------------------------------------------------------------ manifest source


def test_source_manifest_digest_computed_from_bytes(tmp_path) -> None:
    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD)
    source = RegistrySkillSource(storage)

    manifests = source.manifests()
    assert len(manifests) == 1
    manifest = manifests[0]
    assert manifest.uri == "skill://demo/SKILL.md"
    assert manifest.file_uris() == ["skill://demo/SKILL.md"]
    entry = manifest.find_file("skill://demo/SKILL.md")
    assert entry is not None
    assert entry.digest == compute_digest(_SKILL_MD.encode("utf-8"))
    assert entry.size == len(_SKILL_MD.encode("utf-8"))
    assert manifest.frontmatter["name"] == "demo"


def test_source_serves_latest_version_only(tmp_path) -> None:
    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD + "v1\n", version="0.1.0")
    _publish(storage, "demo", _SKILL_MD + "v2\n", version="0.2.0")
    source = RegistrySkillSource(storage)

    manifests = source.manifests()
    assert len(manifests) == 1
    entry = manifests[0].find_file("skill://demo/SKILL.md")
    assert entry is not None
    assert entry.digest == compute_digest((_SKILL_MD + "v2\n").encode("utf-8"))


def test_source_gate_filter(tmp_path) -> None:
    storage = _storage(tmp_path)
    _publish(storage, "pub", _SKILL_MD, gate={"level": "public"})
    _publish(storage, "team", _SKILL_MD, gate={"level": "team"})

    all_source = RegistrySkillSource(storage)
    assert [m.frontmatter["name"] for m in all_source.manifests()] == ["pub", "team"]

    team_source = RegistrySkillSource(storage, include_gate="team")
    assert [m.frontmatter["name"] for m in team_source.manifests()] == ["team"]

    # gate-filtered entries are also invisible to skills/get and reads
    manifest = team_source.get_manifest("skill://pub/SKILL.md")
    assert manifest is None
    assert team_source.read_file("skill://pub/SKILL.md") is None


def test_source_refuses_oversized_entries(tmp_path) -> None:
    storage = _storage(tmp_path)
    big = "x" * (MAX_SKILL_BYTES + 1)
    _publish(storage, "big", big)
    source = RegistrySkillSource(storage)

    assert source.manifests() == []
    assert source.get_manifest("skill://big/SKILL.md") is None


def test_source_fills_missing_frontmatter_name(tmp_path) -> None:
    storage = _storage(tmp_path)
    _publish(storage, "noname", "# no frontmatter here\n")
    source = RegistrySkillSource(storage)

    manifest = source.manifests()[0]
    # URI tail segment equals the (registry) name even without frontmatter.
    assert manifest.frontmatter["name"] == "noname"


def test_source_overrides_drifting_frontmatter_name(tmp_path) -> None:
    storage = _storage(tmp_path)
    # Frontmatter claims a different name than the registry key: the
    # registry name is authoritative because it defines the URI.
    _publish(storage, "real", "---\nname: drifting\n---\nbody\n")
    source = RegistrySkillSource(storage)

    manifest = source.manifests()[0]
    assert manifest.frontmatter["name"] == "real"
    assert manifest.uri == "skill://real/SKILL.md"


def test_source_read_file_only_serves_skill_md(tmp_path) -> None:
    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD)
    source = RegistrySkillSource(storage)

    assert source.read_file("skill://demo/SKILL.md") == _SKILL_MD.encode("utf-8")
    assert source.read_file("skill://demo/other.md") is None
    assert source.read_file("skill://missing/SKILL.md") is None


# ------------------------------------------------------------ protocol layer


async def _connected(server: SkillMCPServer):
    from mcp.shared.memory import create_connected_server_and_client_session

    return create_connected_server_and_client_session(server)


def _server(storage: RegistryStorage, **kwargs) -> SkillMCPServer:
    return SkillMCPServer(RegistrySkillSource(storage, **kwargs))


def _extensions_of(result) -> dict:
    """Extension declarations from an InitializeResult (extra capability)."""
    extra = result.capabilities.model_extra or {}
    extensions = extra.get("extensions")
    return extensions if isinstance(extensions, dict) else {}


@pytest.mark.asyncio
async def test_protocol_declares_skills_extension(tmp_path) -> None:
    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD)

    async with await _connected(_server(storage)) as session:
        result = await session.initialize()
        extensions = _extensions_of(result)
        assert SKILLS_EXTENSION_ID in extensions
        assert extensions[SKILLS_EXTENSION_ID].get("directoryRead") is True
        assert result.capabilities.resources is not None


@pytest.mark.asyncio
async def test_protocol_skills_list_and_get(tmp_path) -> None:
    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD)

    async with await _connected(_server(storage)) as session:
        request = mcp_wire.SkillsListRequest(params=mcp_wire.SkillsListRequestParams())
        listed = await session.send_request(request, mcp_wire.SkillsListResult)
        assert listed.resultType == "complete"
        assert listed.ttlMs is not None and listed.ttlMs > 0
        assert listed.cacheScope == "public"
        assert [s.frontmatter["name"] for s in listed.skills] == ["demo"]
        resource = listed.skills[0].resources[0]
        assert resource["uri"] == "skill://demo/SKILL.md"
        assert resource["digest"] == compute_digest(_SKILL_MD.encode("utf-8"))

        get = mcp_wire.SkillsGetRequest(
            params=mcp_wire.SkillsGetRequestParams(uri="skill://demo/SKILL.md")
        )
        fetched = await session.send_request(get, mcp_wire.SkillsGetResult)
        assert fetched.skill.uri == "skill://demo/SKILL.md"
        assert fetched.skill.resources[0]["size"] == len(_SKILL_MD.encode("utf-8"))


@pytest.mark.asyncio
async def test_protocol_skills_list_pagination(tmp_path) -> None:
    storage = _storage(tmp_path)
    for name in ("a", "b", "c"):
        _publish(storage, name, f"---\nname: {name}\n---\n\ncontent {name}\n")

    async with await _connected(_server(storage, page_size=2)) as session:
        page1 = await session.send_request(
            mcp_wire.SkillsListRequest(params=mcp_wire.SkillsListRequestParams()),
            mcp_wire.SkillsListResult,
        )
        assert [s.frontmatter["name"] for s in page1.skills] == ["a", "b"]
        assert page1.nextCursor is not None

        page2 = await session.send_request(
            mcp_wire.SkillsListRequest(
                params=mcp_wire.SkillsListRequestParams(cursor=page1.nextCursor)
            ),
            mcp_wire.SkillsListResult,
        )
        assert [s.frontmatter["name"] for s in page2.skills] == ["c"]
        assert page2.nextCursor is None


@pytest.mark.asyncio
async def test_protocol_unknown_uri_returns_invalid_params(tmp_path) -> None:
    from mcp.shared.exceptions import McpError

    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD)

    async with await _connected(_server(storage)) as session:
        get = mcp_wire.SkillsGetRequest(
            params=mcp_wire.SkillsGetRequestParams(uri="skill://nope/SKILL.md")
        )
        with pytest.raises(McpError) as excinfo:
            await session.send_request(get, mcp_wire.SkillsGetResult)
        assert excinfo.value.error.code == -32602

        with pytest.raises(McpError) as excinfo:
            await session.read_resource("skill://demo/other.md")
        assert excinfo.value.error.code == -32602


@pytest.mark.asyncio
async def test_protocol_invalid_cursor_returns_invalid_params(tmp_path) -> None:
    from mcp.shared.exceptions import McpError

    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD)

    async with await _connected(_server(storage)) as session:
        request = mcp_wire.SkillsListRequest(
            params=mcp_wire.SkillsListRequestParams(cursor="not-a-number")
        )
        with pytest.raises(McpError) as excinfo:
            await session.send_request(request, mcp_wire.SkillsListResult)
        assert excinfo.value.error.code == -32602


@pytest.mark.asyncio
async def test_protocol_read_resource_and_directory(tmp_path) -> None:
    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD)

    async with await _connected(_server(storage)) as session:
        result = await session.read_resource("skill://demo/SKILL.md")
        contents = result.contents[0]
        assert contents.mimeType == "text/markdown"
        assert "Follow the checklist." in contents.text

        request = mcp_wire.DirectoryReadRequest(
            params=mcp_wire.DirectoryReadRequestParams(uri="skill://demo")
        )
        listing = await session.send_request(request, mcp_wire.DirectoryReadResult)
        assert [(r.uri, r.mimeType) for r in listing.resources] == [
            ("skill://demo/SKILL.md", "text/markdown")
        ]


@pytest.mark.asyncio
async def test_protocol_directory_uri_with_trailing_slash_rejected(tmp_path) -> None:
    from mcp.shared.exceptions import McpError

    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD)

    async with await _connected(_server(storage)) as session:
        request = mcp_wire.DirectoryReadRequest(
            params=mcp_wire.DirectoryReadRequestParams(uri="skill://demo/")
        )
        with pytest.raises(McpError) as excinfo:
            await session.send_request(request, mcp_wire.DirectoryReadResult)
        assert excinfo.value.error.code == -32602


class _MultiFileSource:
    """Duck-typed source exposing a hand-built multi-file manifest."""

    def __init__(self, manifest) -> None:
        self._manifest = manifest

    def manifests(self) -> List:
        return [self._manifest]

    def get_manifest(self, uri: str):
        return self._manifest if uri == self._manifest.uri else None

    def read_file(self, uri: str) -> Optional[bytes]:
        return None


@pytest.mark.asyncio
async def test_protocol_directory_browse_is_non_recursive(tmp_path) -> None:
    from agenticx.skills.manifest import SkillFileEntry, SkillManifest

    files = {
        "skill://multi/SKILL.md": b"---\nname: multi\n---\nbody",
        "skill://multi/references/a.md": b"a",
        "skill://multi/references/deep/b.md": b"b",
        "skill://multi/scripts/run.sh": b"#!/bin/sh\n",
    }
    manifest = SkillManifest(
        uri="skill://multi/SKILL.md",
        frontmatter={"name": "multi", "description": ""},
        resources=[
            SkillFileEntry(uri=uri, digest=compute_digest(content), size=len(content))
            for uri, content in files.items()
        ],
    )
    server = SkillMCPServer(_MultiFileSource(manifest))

    async with await _connected(server) as session:
        async def _dir(uri: str):
            request = mcp_wire.DirectoryReadRequest(
                params=mcp_wire.DirectoryReadRequestParams(uri=uri)
            )
            result = await session.send_request(request, mcp_wire.DirectoryReadResult)
            return [(r.uri, r.mimeType) for r in result.resources]

        # root: SKILL.md + references/ + scripts/ (no nested deep/)
        assert await _dir("skill://multi") == [
            ("skill://multi/SKILL.md", "text/markdown"),
            ("skill://multi/references", "inode/directory"),
            ("skill://multi/scripts", "inode/directory"),
        ]
        # references/: a.md + deep/ only (direct children)
        assert await _dir("skill://multi/references") == [
            ("skill://multi/references/a.md", "text/markdown"),
            ("skill://multi/references/deep", "inode/directory"),
        ]
        # unknown directory inside a known skill -> invalid params
        from mcp.shared.exceptions import McpError

        with pytest.raises(McpError) as excinfo:
            await _dir("skill://multi/missing")
        assert excinfo.value.error.code == -32602


@pytest.mark.asyncio
async def test_protocol_resources_list_enumerates_files(tmp_path) -> None:
    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD)

    async with await _connected(_server(storage)) as session:
        result = await session.list_resources()
        assert [str(r.uri) for r in result.resources] == ["skill://demo/SKILL.md"]


# ------------------------------------------------------------- stdio transport


@pytest.mark.asyncio
async def test_stdio_transport_round_trip(tmp_path) -> None:
    import os

    from mcp.client.session import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client

    registry = tmp_path / "registry.json"
    storage = RegistryStorage(registry)
    _publish(storage, "demo", _SKILL_MD)

    repo_root = str(Path(__file__).resolve().parents[1])
    env = dict(os.environ)
    env["PYTHONPATH"] = repo_root + os.pathsep + env.get("PYTHONPATH", "")
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "agenticx.skills.mcp_server", "--registry", str(registry)],
        env=env,
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            assert SKILLS_EXTENSION_ID in _extensions_of(init)

            listed = await session.send_request(
                mcp_wire.SkillsListRequest(params=mcp_wire.SkillsListRequestParams()),
                mcp_wire.SkillsListResult,
            )
            assert [s.frontmatter["name"] for s in listed.skills] == ["demo"]

            read_result = await session.read_resource("skill://demo/SKILL.md")
            assert "Follow the checklist." in read_result.contents[0].text


@pytest.mark.asyncio
async def test_stdio_transport_gate_filter(tmp_path) -> None:
    import os

    from mcp.client.session import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client

    registry = tmp_path / "registry.json"
    storage = RegistryStorage(registry)
    _publish(storage, "pub", _SKILL_MD, gate={"level": "public"})
    _publish(storage, "team", _SKILL_MD, gate={"level": "team"})

    repo_root = str(Path(__file__).resolve().parents[1])
    env = dict(os.environ)
    env["PYTHONPATH"] = repo_root + os.pathsep + env.get("PYTHONPATH", "")
    params = StdioServerParameters(
        command=sys.executable,
        args=[
            "-m",
            "agenticx.skills.mcp_server",
            "--registry",
            str(registry),
            "--include-gate",
            "team",
        ],
        env=env,
    )

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            listed = await session.send_request(
                mcp_wire.SkillsListRequest(params=mcp_wire.SkillsListRequestParams()),
                mcp_wire.SkillsListResult,
            )
            assert [s.frontmatter["name"] for s in listed.skills] == ["team"]


# ------------------------------------------------- streamable HTTP transport


@pytest.mark.asyncio
async def test_http_transport_round_trip(tmp_path) -> None:
    import uvicorn

    from agenticx.tools.remote_v2 import MCPClientV2, MCPServerConfig

    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD)
    source = RegistrySkillSource(storage)
    app = build_http_app(source)

    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    try:
        for _ in range(100):
            if server.started and server.servers:
                break
            await asyncio.sleep(0.05)
        port = server.servers[0].sockets[0].getsockname()[1]

        client = MCPClientV2(
            MCPServerConfig(name="local-serve", url=f"http://127.0.0.1:{port}/")
        )
        async with client:
            assert client.supports_skills() is True
            assert client.supports_directory_read() is True

            manifests = await client.list_skills()
            assert [m.name for m in manifests] == ["demo"]
            assert manifests[0].file_uris() == ["skill://demo/SKILL.md"]

            manifest = await client.get_skill("skill://demo/SKILL.md")
            entry = manifest.find_file("skill://demo/SKILL.md")
            assert entry is not None
            assert entry.digest == compute_digest(_SKILL_MD.encode("utf-8"))

            content = await client.read_resource("skill://demo/SKILL.md")
            assert "Follow the checklist." in content.contents[0].text

            children = await client.read_directory("skill://demo")
            assert [c.uri for c in children] == ["skill://demo/SKILL.md"]
    finally:
        server.should_exit = True
        await asyncio.wait_for(task, timeout=5)


@pytest.mark.asyncio
async def test_http_transport_bearer_token(tmp_path) -> None:
    import httpx
    import uvicorn

    storage = _storage(tmp_path)
    _publish(storage, "demo", _SKILL_MD)
    app = build_http_app(RegistrySkillSource(storage), token="s3cret")

    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    try:
        for _ in range(100):
            if server.started and server.servers:
                break
            await asyncio.sleep(0.05)
        port = server.servers[0].sockets[0].getsockname()[1]
        base = f"http://127.0.0.1:{port}/"

        async with httpx.AsyncClient() as http:
            mcp_headers = {"Accept": "application/json, text/event-stream"}
            denied = await http.post(
                base,
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
                headers=mcp_headers,
            )
            assert denied.status_code == 401

            allowed = await http.post(
                base,
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
                headers={
                    **mcp_headers,
                    "Authorization": "Bearer s3cret",
                },
            )
            assert allowed.status_code == 200
    finally:
        server.should_exit = True
        await asyncio.wait_for(task, timeout=5)
