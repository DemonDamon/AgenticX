"""Host-side tests for Skills over MCP extension probing and method wrappers.

Uses a fake ClientSession to assert the JSON-RPC method/params structure
without a live server. Transport-level integration is covered by
tests/test_mcp_skills_server.py (SP2) and tests/test_skills_e2e.py (SP4).
"""

from __future__ import annotations

import json
from typing import Any, List, Optional
from unittest.mock import AsyncMock

import pytest

from agenticx.skills.manifest import (
    SkillExtensionNotDeclaredError,
    SkillManifest,
    SkillNotFoundError,
    compute_digest,
)
from agenticx.skills import mcp_wire
from agenticx.tools.remote_v2 import MCPClientV2, MCPServerConfig


def _init_result(extensions: Optional[dict] = None):
    import mcp.types as mcp_types

    caps = {"resources": {"subscribe": False, "listChanged": False}}
    if extensions is not None:
        caps["extensions"] = extensions
    return mcp_types.InitializeResult.model_validate(
        {
            "protocolVersion": mcp_types.LATEST_PROTOCOL_VERSION,
            "capabilities": caps,
            "serverInfo": {"name": "fake", "version": "0"},
        }
    )


def _client(extensions: Optional[dict] = None) -> MCPClientV2:
    client = MCPClientV2(
        MCPServerConfig(name="fake-srv", command="true")
    )
    client._init_result = _init_result(extensions)
    return client


def _skill_entry(name: str = "demo", files: Optional[List[bytes]] = None) -> dict:
    resources = []
    for idx, content in enumerate(files or [b"---\nname: demo\n---\n\nbody\n"]):
        uri = "skill://demo/SKILL.md" if idx == 0 else f"skill://demo/ref{idx}.md"
        resources.append(
            {"uri": uri, "digest": compute_digest(content), "size": len(content)}
        )
    return {
        "uri": "skill://demo/SKILL.md",
        "frontmatter": {"name": name, "description": "d"},
        "resources": resources,
    }


class FakeSession:
    """Records send_request calls and answers with scripted results."""

    def __init__(self, responses: List[Any]) -> None:
        self.responses = list(responses)
        self.requests: List[Any] = []

    async def send_request(self, request, result_type, *args, **kwargs):
        self.requests.append((request, result_type))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return result_type.model_validate(response)


class _NullLock:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None


def _attach_session(client: MCPClientV2, session: FakeSession) -> None:
    async def _ensure() -> Any:
        return session

    client._ensure_session = _ensure  # type: ignore[assignment]
    client._stdio_lock = _NullLock()  # type: ignore[assignment]


# ----------------------------------------------------------------- capability


def test_supports_skills_detects_extension_declaration() -> None:
    client = _client(
        extensions={mcp_wire.SKILLS_EXTENSION_ID: {"directoryRead": True}}
    )
    assert client.supports_skills() is True
    assert client.supports_directory_read() is True


def test_supports_skills_false_without_declaration() -> None:
    assert _client().supports_skills() is False
    assert _client(extensions={"other/extension": {}}).supports_skills() is False


def test_directory_read_defaults_to_false() -> None:
    client = _client(extensions={mcp_wire.SKILLS_EXTENSION_ID: {}})
    assert client.supports_skills() is True
    assert client.supports_directory_read() is False


@pytest.mark.asyncio
async def test_skills_methods_reject_undeclared_extension_without_request() -> None:
    client = _client()  # no extension declared
    session = FakeSession([])
    _attach_session(client, session)
    with pytest.raises(SkillExtensionNotDeclaredError):
        await client.list_skills()
    with pytest.raises(SkillExtensionNotDeclaredError):
        await client.get_skill("skill://demo/SKILL.md")
    assert session.requests == []  # nothing was sent over the wire


@pytest.mark.asyncio
async def test_directory_read_requires_directory_read_flag() -> None:
    client = _client(extensions={mcp_wire.SKILLS_EXTENSION_ID: {}})
    session = FakeSession([])
    _attach_session(client, session)
    with pytest.raises(SkillExtensionNotDeclaredError):
        await client.read_directory("skill://demo")
    assert session.requests == []


@pytest.mark.asyncio
async def test_skills_methods_reject_unconnected_client() -> None:
    client = MCPClientV2(MCPServerConfig(name="x", command="true"))
    with pytest.raises(SkillExtensionNotDeclaredError):
        await client.list_skills()


# ----------------------------------------------------------------- skills/list


@pytest.mark.asyncio
async def test_list_skills_sends_correct_method_and_paginates() -> None:
    client = _client(extensions={mcp_wire.SKILLS_EXTENSION_ID: {}})
    page1 = {
        "resultType": "complete",
        "skills": [_skill_entry()],
        "nextCursor": "c2",
        "ttlMs": 300000,
        "cacheScope": "public",
    }
    page2 = {"resultType": "complete", "skills": [], "nextCursor": None}
    session = FakeSession([page1, page2])
    _attach_session(client, session)

    manifests = await client.list_skills()

    assert len(manifests) == 1
    assert isinstance(manifests[0], SkillManifest)
    assert manifests[0].name == "demo"

    (req1, res1), (req2, res2) = session.requests
    assert req1.method == "skills/list"
    assert req1.params is None  # first page: no cursor
    assert res1 is mcp_wire.SkillsListResult
    assert req2.method == "skills/list"
    assert req2.params.cursor == "c2"


# ------------------------------------------------------------------ skills/get


@pytest.mark.asyncio
async def test_get_skill_builds_request_and_parses_entry() -> None:
    client = _client(extensions={mcp_wire.SKILLS_EXTENSION_ID: {}})
    session = FakeSession([{"resultType": "complete", "skill": _skill_entry()}])
    _attach_session(client, session)

    manifest = await client.get_skill("skill://demo/SKILL.md")

    req, res = session.requests[0]
    assert req.method == "skills/get"
    assert req.params.uri == "skill://demo/SKILL.md"
    assert res is mcp_wire.SkillsGetResult
    assert manifest.uri == "skill://demo/SKILL.md"


@pytest.mark.asyncio
async def test_get_skill_translates_invalid_params_to_not_found() -> None:
    import mcp.types as mcp_types
    from mcp.shared.exceptions import McpError

    client = _client(extensions={mcp_wire.SKILLS_EXTENSION_ID: {}})
    session = FakeSession(
        [McpError(mcp_types.ErrorData(code=-32602, message="unknown skill"))]
    )
    _attach_session(client, session)

    with pytest.raises(SkillNotFoundError):
        await client.get_skill("skill://demo/SKILL.md")


@pytest.mark.asyncio
async def test_get_skill_propagates_other_errors() -> None:
    from mcp.shared.exceptions import McpError
    import mcp.types as mcp_types

    client = _client(extensions={mcp_wire.SKILLS_EXTENSION_ID: {}})
    session = FakeSession(
        [McpError(mcp_types.ErrorData(code=-32603, message="boom"))]
    )
    _attach_session(client, session)

    with pytest.raises(Exception) as excinfo:
        await client.get_skill("skill://demo/SKILL.md")
    assert not isinstance(excinfo.value, SkillNotFoundError)


# ------------------------------------------------------- resources/directory


@pytest.mark.asyncio
async def test_read_directory_sends_uri_and_collects_children() -> None:
    client = _client(
        extensions={mcp_wire.SKILLS_EXTENSION_ID: {"directoryRead": True}}
    )
    response = {
        "resultType": "complete",
        "resources": [
            {"uri": "skill://demo/references", "name": "references", "mimeType": "inode/directory"},
            {"uri": "skill://demo/SKILL.md", "name": "SKILL.md", "mimeType": "text/markdown"},
        ],
    }
    session = FakeSession([response])
    _attach_session(client, session)

    children = await client.read_directory("skill://demo")

    req, res = session.requests[0]
    assert req.method == "resources/directory/read"
    assert req.params.uri == "skill://demo"
    assert res is mcp_wire.DirectoryReadResult
    assert len(children) == 2
    assert children[0].mimeType == "inode/directory"
    assert children[1].mimeType == "text/markdown"


# --------------------------------------------------------------- read resource


@pytest.mark.asyncio
async def test_read_resource_uses_sdk_channel() -> None:
    client = _client(extensions={mcp_wire.SKILLS_EXTENSION_ID: {}})

    class _ReadResult:
        pass

    fake_read = AsyncMock(return_value=_ReadResult())
    session = FakeSession([])
    session.read_resource = fake_read  # type: ignore[attr-defined]
    _attach_session(client, session)

    result = await client.read_resource("skill://demo/SKILL.md")
    fake_read.assert_awaited_once_with("skill://demo/SKILL.md")
    assert isinstance(result, _ReadResult)


# =============================================================================
# SP1 Task 6: full-chain integration with an inline fake MCP server surface.
# list → get → read (verified) → tamper rejection → approval → injection.
# =============================================================================


class InlineFakeServer:
    """Inline stand-in for a skills-capable MCP server (pre-SP2)."""

    def __init__(self) -> None:
        self.skills: dict = {}
        self.resources: dict = {}

    def serve(self, name: str = "demo") -> None:
        skill_md = (
            f"---\nname: {name}\ndescription: {name} inline skill\n---\n\n"
            f"# {name}\n\nFollow the checklist.\n"
        ).encode()
        checklist = b"# Checklist\n\n- verify digests\n- approve before use\n"
        self.skills[f"skill://{name}/SKILL.md"] = {
            "uri": f"skill://{name}/SKILL.md",
            "frontmatter": {"name": name, "description": f"{name} inline skill"},
            "resources": [
                {
                    "uri": f"skill://{name}/SKILL.md",
                    "digest": compute_digest(skill_md),
                    "size": len(skill_md),
                },
                {
                    "uri": f"skill://{name}/references/checklist.md",
                    "digest": compute_digest(checklist),
                    "size": len(checklist),
                },
            ],
        }
        self.resources[f"skill://{name}/SKILL.md"] = skill_md
        self.resources[f"skill://{name}/references/checklist.md"] = checklist

    async def list_skills(self):
        from agenticx.skills.manifest import SkillManifest

        return [SkillManifest.from_skill_entry(e) for e in self.skills.values()]

    async def get_skill(self, uri):
        from agenticx.skills.manifest import SkillManifest, SkillNotFoundError

        entry = self.skills.get(uri)
        if entry is None:
            raise SkillNotFoundError(uri)
        return SkillManifest.from_skill_entry(entry)

    async def read_resource(self, uri):
        content = self.resources[uri]

        class _Block:
            def __init__(self) -> None:
                self.uri = uri
                self.text = content.decode("utf-8")
                self.mimeType = "text/markdown"

        class _Result:
            def __init__(self) -> None:
                self.contents = [_Block()]

        return _Result()


@pytest.mark.asyncio
async def test_full_chain_list_get_read_verify_approve_inject(tmp_path) -> None:
    from agenticx.skills.approval import ApprovalStore, check_activation
    from agenticx.skills.remote_provider import RemoteSkillProvider
    from agenticx.skills.unified_index import UnifiedSkillIndex
    from agenticx.tools.skill_bundle import SkillBundleLoader, SkillTool

    server = InlineFakeServer()
    server.serve("demo")

    provider = RemoteSkillProvider(server, "inline-srv", cache_root=tmp_path / "cache")
    index = UnifiedSkillIndex(approval_store=ApprovalStore(tmp_path / "approvals.json"))
    index.add_provider(provider)

    # 1. list
    views = await index.list_skills(origin="mcp")
    assert [v.name for v in views] == ["demo"]
    assert views[0].file_count == 2

    # 2. get
    view = await index.get("inline-srv::skill://demo/SKILL.md")
    assert view is not None

    # 3. read with reading-point verification (cache miss → server fetch)
    manifest = await provider.retain("skill://demo/SKILL.md")
    checklist = await provider.read_file("skill://demo/references/checklist.md")
    assert b"verify digests" in checklist.content

    # 4. tamper rejection: server bytes drift from the manifest digest.
    # SKILL.md has not been fetched yet, so the read must go to the server
    # and fail digest verification against the retained manifest.
    good = server.resources["skill://demo/SKILL.md"]
    server.resources["skill://demo/SKILL.md"] = good.replace(
        b"Follow", b"FOLLOW"
    )
    from agenticx.skills.manifest import SkillIntegrityError

    with pytest.raises(SkillIntegrityError):
        await provider.read_file("skill://demo/SKILL.md")
    server.resources["skill://demo/SKILL.md"] = good  # restore

    # 5. approval bound to the digest set gates activation
    store = ApprovalStore(tmp_path / "approvals.json")
    denied = await index.read_remote_skill("demo", require_approval=True)
    assert denied.status == "denied"

    approval = store.grant("inline-srv", manifest)
    decision = check_activation(
        manifest,
        skill_dir=provider.cache_dir_for(manifest),
        approval=approval,
        require_approval=True,
    )
    assert decision.allowed is True

    # 6. injection: SkillTool reads the approved remote skill
    scan_root = tmp_path / "local-skills"
    scan_root.mkdir()
    (scan_root / "placeholder.md").write_text("not a skill", encoding="utf-8")
    tool = SkillTool(
        loader=SkillBundleLoader(search_paths=[scan_root]),
        unified_index=index,
    )
    listing = tool.run(action="list")
    assert "Remote skills (MCP):" in listing
    assert "[mcp:inline-srv]" in listing

    content = tool.run(action="read", skill_name="demo")
    assert "Reading: demo" in content
    assert "Origin: mcp" in content
    assert "Follow the checklist." in content


# ------------------------------------------------------------- CLI helpers


def test_load_mcp_server_configs_parses_mcp_json(tmp_path) -> None:
    from agenticx.cli.skills_commands import _load_mcp_server_configs

    mcp_json = tmp_path / "mcp.json"
    mcp_json.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "skill-srv": {"command": "python", "args": ["-m", "demo"]},
                    "http-srv": {"url": "http://127.0.0.1:9000/mcp"},
                    "not-a-dict": "oops",
                }
            }
        ),
        encoding="utf-8",
    )

    configs = _load_mcp_server_configs(mcp_json, None)
    assert [c.name for c in configs] == ["skill-srv", "http-srv"]
    assert configs[0].transport == "stdio"
    assert configs[1].transport == "streamable_http"

    only = _load_mcp_server_configs(mcp_json, "http-srv")
    assert [c.name for c in only] == ["http-srv"]


def test_load_mcp_server_configs_missing_file_returns_empty(tmp_path) -> None:
    from agenticx.cli.skills_commands import _load_mcp_server_configs

    assert _load_mcp_server_configs(tmp_path / "absent.json", None) == []


def test_load_mcp_server_configs_invalid_entry_is_skipped(tmp_path) -> None:
    from agenticx.cli.skills_commands import _load_mcp_server_configs

    mcp_json = tmp_path / "mcp.json"
    mcp_json.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "bad": {"command": "x", "url": "http://both.set"},
                    "good": {"command": "true"},
                }
            }
        ),
        encoding="utf-8",
    )
    configs = _load_mcp_server_configs(mcp_json, None)
    assert [c.name for c in configs] == ["good"]
