"""UnifiedSkillIndex tests: aggregation, coexistence, discovery exclusion.

Covers SP1 Task 5: local + remote skills aggregate into one view keyed by
``{server_id}::{uri}`` (same name from different origins coexists, never
replaces), remote reads go through the activation gate, and the remote skill
cache directory stays excluded from filesystem discovery.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

import pytest

from agenticx.skills.approval import ApprovalStore
from agenticx.skills.manifest import SkillManifest, compute_digest
from agenticx.skills.registry import RegistrySkillEntry, RegistryStorage
from agenticx.skills.remote_provider import RemoteSkillProvider
from agenticx.skills.unified_index import (
    LOCAL_SERVER_ID,
    RemoteReadResult,
    SkillView,
    UnifiedSkillIndex,
)
from agenticx.tools.skill_bundle import (
    SKILL_DISCOVERY_EXCLUDED_DIRS,
    SkillBundleLoader,
    SkillTool,
)

# --------------------------------------------------------------------- fakes


class FakeSkillsClient:
    def __init__(self) -> None:
        self.skills: Dict[str, SkillManifest] = {}
        self.resources: Dict[str, bytes] = {}
        self.fail_list = False

    def add_skill(self, manifest: SkillManifest, files: Optional[Dict[str, bytes]] = None) -> None:
        self.skills[manifest.uri] = manifest
        for uri, content in (files or {}).items():
            self.resources[uri] = content

    async def list_skills(self) -> List[SkillManifest]:
        if self.fail_list:
            raise RuntimeError("connection lost")
        return list(self.skills.values())

    async def get_skill(self, uri: str) -> SkillManifest:
        manifest = self.skills.get(uri)
        if manifest is None:
            from agenticx.skills.manifest import SkillNotFoundError

            raise SkillNotFoundError(uri)
        return manifest

    async def read_resource(self, uri: str):
        content = self.resources.get(uri)
        if content is None:
            raise AssertionError(f"no fake resource registered for {uri}")

        class _Block:
            def __init__(self, text: str) -> None:
                self.uri = uri
                self.text = text
                self.mimeType = "text/markdown"

        class _Result:
            def __init__(self) -> None:
                self.contents = [_Block(content.decode("utf-8"))]

        return _Result()


def _remote_skill(name: str = "demo") -> "tuple[SkillManifest, Dict[str, bytes]]":
    skill_md = (
        f"---\nname: {name}\ndescription: {name} via MCP\n---\n\n# {name}\n\nRemote body.\n"
    ).encode()
    files = {f"skill://{name}/SKILL.md": skill_md}
    manifest = SkillManifest(
        uri=f"skill://{name}/SKILL.md",
        frontmatter={"name": name, "description": f"{name} via MCP"},
        resources=[
            {
                "uri": f"skill://{name}/SKILL.md",
                "digest": compute_digest(skill_md),
                "size": len(skill_md),
            }
        ],
    )
    return manifest, files


def _registry(tmp_path: Path, name: str = "demo") -> RegistryStorage:
    storage = RegistryStorage(tmp_path / "registry.json")
    storage.publish(
        RegistrySkillEntry(
            name=name,
            version="0.2.0",
            description=f"{name} local entry",
        )
    )
    return storage


def _index_with_remote(
    tmp_path: Path,
    *,
    server_id: str = "srv-a",
    name: str = "demo",
    approval_store: Optional[ApprovalStore] = None,
) -> "tuple[UnifiedSkillIndex, FakeSkillsClient, RemoteSkillProvider]":
    client = FakeSkillsClient()
    manifest, files = _remote_skill(name)
    client.add_skill(manifest, files)
    provider = RemoteSkillProvider(client, server_id, cache_root=tmp_path / "cache")
    index = UnifiedSkillIndex(approval_store=approval_store)
    index.add_provider(provider)
    return index, client, provider


# ----------------------------------------------------------- aggregation


async def test_local_and_remote_same_name_coexist(tmp_path):
    index, _, _ = _index_with_remote(tmp_path)
    index._storage = _registry(tmp_path)  # local "demo" too

    views = await index.list_skills()
    assert len(views) == 2
    names = {v.name for v in views}
    assert names == {"demo"}  # same name, two origins — coexist, no replace
    origins = {v.origin for v in views}
    assert origins == {"local", "mcp"}
    ids = {v.skill_id for v in views}
    assert ids == {
        f"{LOCAL_SERVER_ID}::registry://demo",
        "srv-a::skill://demo/SKILL.md",
    }


async def test_list_filters_by_origin(tmp_path):
    index, _, _ = _index_with_remote(tmp_path)
    index._storage = _registry(tmp_path)

    remote_only = await index.list_skills(origin="mcp")
    assert len(remote_only) == 1
    assert remote_only[0].origin == "mcp"

    local_only = await index.list_skills(origin="local")
    assert len(local_only) == 1
    assert local_only[0].origin == "local"


async def test_local_view_carries_version(tmp_path):
    index, _, _ = _index_with_remote(tmp_path)
    index._storage = _registry(tmp_path)

    view = await index.get("local::registry://demo")
    assert view is not None
    assert view.origin == "local"
    assert view.version == "0.2.0"
    assert view.manifest is None


async def test_remote_view_carries_manifest(tmp_path):
    index, _, _ = _index_with_remote(tmp_path)
    view = await index.get("srv-a::skill://demo/SKILL.md")
    assert view is not None
    assert view.origin == "mcp"
    assert view.manifest is not None
    assert view.file_count == 1
    assert view.total_bytes == view.manifest.total_bytes()


async def test_get_unknown_returns_none(tmp_path):
    index, _, _ = _index_with_remote(tmp_path)
    assert await index.get("srv-z::skill://demo/SKILL.md") is None
    assert await index.get("srv-a::skill://ghost/SKILL.md") is None
    assert await index.get("local::registry://ghost") is None
    assert await index.get("no-double-colon") is None


async def test_remote_listing_error_is_isolated(tmp_path):
    index, client, _ = _index_with_remote(tmp_path)
    index._storage = _registry(tmp_path)
    client.fail_list = True

    views = await index.list_skills()
    # Remote server down: local skills still list (zero regression).
    assert [v.origin for v in views] == ["local"]


def test_skill_view_to_dict_has_origin_labels(tmp_path):
    view = SkillView(
        origin="mcp",
        server_id="srv-a",
        uri="skill://demo/SKILL.md",
        name="demo",
        description="demo via MCP",
    )
    payload = view.to_dict()
    assert payload["skill_id"] == "srv-a::skill://demo/SKILL.md"
    assert payload["origin"] == "mcp"
    assert payload["server_id"] == "srv-a"


# --------------------------------------------------------- activation gate


async def test_read_remote_skill_denied_without_approval(tmp_path):
    index, _, _ = _index_with_remote(tmp_path)
    result = await index.read_remote_skill("demo", require_approval=True)
    assert isinstance(result, RemoteReadResult)
    assert result.status == "denied"
    assert any("no approval record" in r for r in result.reasons)


async def test_read_remote_skill_ok_with_valid_approval(tmp_path):
    index, _, provider = _index_with_remote(tmp_path)
    store = ApprovalStore(tmp_path / "approvals.json")
    manifest, _ = _remote_skill()
    store.grant("srv-a", manifest)

    result = await index.read_remote_skill(
        "demo", approval_store=store, require_approval=True
    )
    assert result.status == "ok"
    assert result.content is not None
    assert "Remote body." in result.content
    # The skill files were materialized through the verified cache.
    assert (tmp_path / "cache" / "srv-a" / "demo" / "SKILL.md").is_file()


async def test_read_remote_skill_denied_when_approval_goes_stale(tmp_path):
    index, client, provider = _index_with_remote(tmp_path)
    store = ApprovalStore(tmp_path / "approvals.json")
    manifest_v1, files_v1 = _remote_skill()
    store.grant("srv-a", manifest_v1)

    # Server swaps the skill body: same URI set, different digest.
    new_md = b"---\nname: demo\ndescription: demo via MCP\n---\n\n# demo\n\nEvolved body.\n"
    manifest_v2 = SkillManifest(
        uri="skill://demo/SKILL.md",
        frontmatter={"name": "demo", "description": "demo via MCP"},
        resources=[
            {
                "uri": "skill://demo/SKILL.md",
                "digest": compute_digest(new_md),
                "size": len(new_md),
            }
        ],
    )
    client.skills[manifest_v1.uri] = manifest_v2
    client.resources = {"skill://demo/SKILL.md": new_md}

    result = await index.read_remote_skill(
        "demo", approval_store=store, require_approval=True
    )
    assert result.status == "denied"
    assert any("digest changed" in r for r in result.reasons)
    # The stale approval was auto-revoked by the activation path.
    assert store.get("srv-a", manifest_v1.uri) is None


async def test_read_remote_skill_not_found(tmp_path):
    index, _, _ = _index_with_remote(tmp_path)
    result = await index.read_remote_skill("ghost")
    assert result.status == "not_found"


async def test_read_remote_skill_approval_not_required(tmp_path):
    index, _, _ = _index_with_remote(tmp_path)
    result = await index.read_remote_skill("demo", require_approval=False)
    assert result.status == "ok"
    assert result.content is not None


# ------------------------------------------------- discovery exclusion (T5)


def _write_skill(root: Path, name: str) -> None:
    skill_dir = root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {name} skill\n---\n\n# {name}\n",
        encoding="utf-8",
    )


def test_cache_dir_is_excluded_from_filesystem_discovery(tmp_path):
    assert "cache" in SKILL_DISCOVERY_EXCLUDED_DIRS

    scan_root = tmp_path / "skills"
    scan_root.mkdir()
    # A skill placed directly under a `cache/` dir inside the scan root.
    _write_skill(scan_root / "cache", "cached-skill")
    # A normal skill for contrast.
    _write_skill(scan_root, "normal-skill")

    loader = SkillBundleLoader(search_paths=[scan_root])
    names = [s.name for s in loader.scan()]
    assert "normal-skill" in names
    assert "cached-skill" not in names


def test_cache_dir_excluded_at_nested_level(tmp_path):
    scan_root = tmp_path / "skills"
    scan_root.mkdir()
    grouped = scan_root / "grouped"
    grouped.mkdir()
    _write_skill(grouped / "cache", "nested-cached-skill")
    _write_skill(scan_root, "top-skill")

    loader = SkillBundleLoader(search_paths=[scan_root])
    names = [s.name for s in loader.scan()]
    assert "top-skill" in names
    assert "nested-cached-skill" not in names


# --------------------------------------------------- SkillTool integration


def _local_loader(tmp_path: Path) -> SkillBundleLoader:
    scan_root = tmp_path / "local-skills"
    scan_root.mkdir()
    _write_skill(scan_root, "local-only")
    return SkillBundleLoader(search_paths=[scan_root])


def test_skill_tool_lists_remote_skills_with_origin_tag(tmp_path):
    index, _, _ = _index_with_remote(tmp_path)
    tool = SkillTool(loader=_local_loader(tmp_path), unified_index=index)

    result = tool.run(action="list")
    assert "local-only" in result
    assert "Remote skills (MCP):" in result
    assert "[mcp:srv-a]" in result
    assert "demo" in result


def test_skill_tool_reads_remote_skill_after_approval(tmp_path):
    store = ApprovalStore(tmp_path / "approvals.json")
    index, _, _ = _index_with_remote(tmp_path, approval_store=store)
    manifest, _ = _remote_skill()
    store.grant("srv-a", manifest)
    tool = SkillTool(loader=_local_loader(tmp_path), unified_index=index)

    result = tool.run(action="read", skill_name="demo")
    assert "Reading: demo" in result
    assert "Origin: mcp" in result
    assert "Remote body." in result


def test_skill_tool_denies_remote_skill_without_approval(tmp_path):
    store = ApprovalStore(tmp_path / "approvals.json")
    index, _, _ = _index_with_remote(tmp_path, approval_store=store)
    tool = SkillTool(loader=_local_loader(tmp_path), unified_index=index)

    result = tool.run(action="read", skill_name="demo")
    assert "not activated" in result
    assert "agx skills approve" in result


def test_skill_tool_without_index_behaves_as_before(tmp_path):
    tool = SkillTool(loader=_local_loader(tmp_path))

    result = tool.run(action="read", skill_name="nonexistent")
    assert "not found" in result.lower()
    listing = tool.run(action="list")
    assert "Remote skills" not in listing
