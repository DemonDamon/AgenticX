"""End-to-end Skills over MCP acceptance tests (SP4, SEP-2640).

Two AgenticX instances over a real stdio transport:
- Server: ``python -m agenticx.skills.mcp_server --registry <file>``
- Host: MCPClientV2 + RemoteSkillProvider (+ UnifiedSkillIndex / SkillTool)

T1 covers the full happy chain (list → install/approve → inject as a BaseTool,
legacy single-file views, gate filtering). T2 covers adversarial governance:
tamper detection with approval revocation, manifest mutation invalidating
approvals, same-name isolation across servers, out-of-manifest reads, and
cache isolation from filesystem discovery.
"""

from __future__ import annotations

import json
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Callable, List

import pytest

from agenticx.skills.approval import ApprovalStore, check_activation
from agenticx.skills.manifest import SkillIntegrityError, compute_digest
from agenticx.skills.registry import (
    RegistrySkillEntry,
    RegistryStorage,
    build_registry_entry,
)
from agenticx.skills.remote_provider import RemoteSkillProvider
from agenticx.tools.remote_v2 import MCPServerConfig, MCPClientV2

_REPO_ROOT = Path(__file__).resolve().parents[1]

_MULTI_MD = (
    "---\nname: research-sop\ndescription: Research SOP with references\n"
    "---\n\n# Research SOP\n\nSee the checklist.\n"
)
_CHECKLIST = "# Checklist\n\n- verify digests\n- approve before use\n"
_LEGACY_MD = "---\nname: legacy-one\ndescription: Legacy single file\n---\n\n# Legacy\n\nOld model.\n"
_DISTILLED_MD = (
    "---\nname: distilled-flow\ndescription: GEPA distilled skill\n---\n\n"
    "# Distilled\n\nLearned heuristic.\n"
)


# ------------------------------------------------------------------ fixtures


def _make_skill_dir(
    tmp_path: Path, name: str, *, gate_level: str = "", checklist: str = _CHECKLIST
) -> Path:
    skill_dir = tmp_path / name
    refs = skill_dir / "references"
    refs.mkdir(parents=True)
    frontmatter = f"---\nname: {name}\ndescription: {name} demo\n"
    if gate_level:
        # build_registry_entry reads the gate from metadata.agenticx.gate.
        frontmatter += (
            "metadata:\n  agenticx:\n    gate:\n"
            f"      level: {gate_level}\n"
        )
    (skill_dir / "SKILL.md").write_text(
        frontmatter + "---\n\n" + f"# {name}\n\nSee the checklist.\n",
        encoding="utf-8",
    )
    (refs / "checklist.md").write_text(checklist, encoding="utf-8")
    return skill_dir


def _registry_path(tmp_path: Path) -> Path:
    return tmp_path / "registry.json"


def _server_config(name: str, registry: Path, *extra_args: str) -> MCPServerConfig:
    return MCPServerConfig(
        name=name,
        command=sys.executable,
        args=[
            "-m",
            "agenticx.skills.mcp_server",
            "--registry",
            str(registry),
            *extra_args,
        ],
        env={"PYTHONPATH": str(_REPO_ROOT)},
    )


@asynccontextmanager
async def _provider(
    name: str, registry: Path, *extra_args: str
) -> AsyncIterator[RemoteSkillProvider]:
    client = MCPClientV2(_server_config(name, registry, *extra_args))
    async with client:
        yield RemoteSkillProvider(client, server_id=name)


# =============================================================================
# Task 1: dual-instance happy chain
# =============================================================================


async def test_e2e_server_serves_mixed_registry_entries(tmp_path: Path) -> None:
    """v2 multi-file, v1 legacy, and GEPA learning entries are all served."""
    storage = RegistryStorage(_registry_path(tmp_path))
    storage.publish(build_registry_entry(_make_skill_dir(tmp_path, "research-sop")))
    storage.publish(
        RegistrySkillEntry(
            name="legacy-one",
            version="0.1.0",
            description="Legacy single file",
            skill_content=_LEGACY_MD,
        )
    )
    learning_dir = _make_skill_dir(tmp_path / "learning-copy", "distilled-flow")
    learning_entry = build_registry_entry(learning_dir, origin="learning")
    storage.publish(learning_entry)

    async with _provider("srv", _registry_path(tmp_path)) as provider:
        manifests = await provider.list_skills()
        by_name = {m.name: m for m in manifests}
        assert set(by_name) == {"research-sop", "legacy-one", "distilled-flow"}

        # v2 entry: full multi-file manifest.
        multi = by_name["research-sop"]
        assert multi.file_uris() == [
            "skill://research-sop/SKILL.md",
            "skill://research-sop/references/checklist.md",
        ]

        # v1 entry: host sees a single-file manifest view (compat, no write-back).
        legacy = by_name["legacy-one"]
        assert legacy.file_uris() == ["skill://legacy-one/SKILL.md"]

        # Learning origin round-trips through the storage layer.
        rows = RegistryStorage(_registry_path(tmp_path)).list_entries()
        origins = {r.name: r.origin for r in rows}
        assert origins["distilled-flow"] == "learning"


async def test_e2e_install_chain_approval_and_activation(tmp_path: Path) -> None:
    """Install one skill: verified reads -> digest-bound approval -> activation.

    The BaseTool rendering of remote skills (SkillTool list/read) is covered in
    tests/test_mcp_skills_host.py against an inline server; here the full chain
    runs against a real stdio server via the async activation path.
    """
    from agenticx.skills.unified_index import UnifiedSkillIndex

    registry = _registry_path(tmp_path)
    RegistryStorage(registry).publish(
        build_registry_entry(_make_skill_dir(tmp_path, "research-sop"))
    )
    approvals = ApprovalStore(tmp_path / "approvals.json")

    async with _provider("srv", registry) as provider:
        manifest = await provider.retain("skill://research-sop/SKILL.md")

        # Reading-point verification for every manifest file.
        files = {
            uri: (await provider.read_file(uri)).content
            for uri in manifest.file_uris()
        }
        assert files["skill://research-sop/SKILL.md"].decode("utf-8") == (
            tmp_path / "research-sop" / "SKILL.md"
        ).read_text(encoding="utf-8")

        approval = approvals.grant("srv", manifest)
        assert approvals.find_valid("srv", manifest) is not None
        assert set(approval.file_digests) == set(manifest.digest_map())

        decision = check_activation(
            manifest,
            skill_dir=provider.cache_dir_for(manifest),
            approval=approval,
            require_approval=True,
        )
        assert decision.allowed is True

        # Activation: the unified index serves the approved remote skill.
        index = UnifiedSkillIndex(approval_store=approvals)
        index.add_provider(provider)
        views = await index.list_skills(origin="mcp")
        assert [v.skill_id for v in views] == ["srv::skill://research-sop/SKILL.md"]

        result = await index.read_remote_skill("research-sop", require_approval=True)
        assert result.status == "ok"
        assert result.content is not None
        assert "See the checklist." in result.content


async def test_e2e_gate_filter_only_serves_matching_level(tmp_path: Path) -> None:
    registry = _registry_path(tmp_path)
    storage = RegistryStorage(registry)
    storage.publish(
        build_registry_entry(_make_skill_dir(tmp_path, "open-sop", gate_level="open"))
    )
    storage.publish(
        build_registry_entry(
            _make_skill_dir(tmp_path / "restricted-copy", "secret-sop", gate_level="restricted")
        )
    )

    async with _provider("srv", registry, "--include-gate", "restricted") as provider:
        manifests = await provider.list_skills()
        assert [m.name for m in manifests] == ["secret-sop"]


# =============================================================================
# Task 2: adversarial governance cases
# =============================================================================


def _rewrite_registry_file(
    registry: Path, name: str, mutate: Callable[[dict], None]
) -> None:
    """Mutate one stored entry's v2 manifest fields directly on disk."""
    raw = json.loads(registry.read_text(encoding="utf-8"))
    entry = raw["skills"][name][-1]
    mutate(entry)
    registry.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")


async def test_e2e_tampered_file_rejected_and_approval_revoked(
    tmp_path: Path,
) -> None:
    registry = _registry_path(tmp_path)
    RegistryStorage(registry).publish(
        build_registry_entry(_make_skill_dir(tmp_path, "research-sop"))
    )
    approvals = ApprovalStore(tmp_path / "approvals.json")

    async with _provider("srv", registry) as provider:
        manifest = await provider.retain("skill://research-sop/SKILL.md")
        approval = approvals.grant("srv", manifest)
        assert approvals.find_valid("srv", manifest) is not None

        # Server-side tampering: flip bytes of a supporting file, no version bump.
        def _tamper(entry: dict) -> None:
            entry["file_contents"]["references/checklist.md"] = (
                "# Tampered\n\n- injected step\n"
            )

        _rewrite_registry_file(registry, "research-sop", _tamper)

        # Host read is rejected by reading-point digest verification.
        with pytest.raises(SkillIntegrityError):
            await provider.read_file("skill://research-sop/references/checklist.md")

        # The refreshed manifest no longer matches the approval: auto-revoke.
        fresh = await provider.get_skill("skill://research-sop/SKILL.md")
        assert approvals.revoke_if_invalid("srv", fresh) is True
        assert approvals.get("srv", fresh.uri) is None

        decision = check_activation(
            fresh,
            skill_dir=provider.cache_dir_for(fresh),
            approval=approval,
            require_approval=True,
        )
        assert decision.allowed is False


async def test_e2e_manifest_growth_invalidates_approval(tmp_path: Path) -> None:
    registry = _registry_path(tmp_path)
    RegistryStorage(registry).publish(
        build_registry_entry(_make_skill_dir(tmp_path, "research-sop"))
    )
    approvals = ApprovalStore(tmp_path / "approvals.json")

    async with _provider("srv", registry) as provider:
        manifest = await provider.retain("skill://research-sop/SKILL.md")
        approvals.grant("srv", manifest)
        assert approvals.find_valid("srv", manifest) is not None

        # Server adds a file to the skill without bumping the version.
        def _grow(entry: dict) -> None:
            content = "- extra file\n"
            entry["files"].append(
                {
                    "path": "references/extra.md",
                    "digest": compute_digest(content.encode("utf-8")),
                    "size": len(content),
                }
            )
            entry["file_contents"]["references/extra.md"] = content

        _rewrite_registry_file(registry, "research-sop", _grow)

        fresh = await provider.get_skill("skill://research-sop/SKILL.md")
        assert len(fresh.file_uris()) == 3  # SKILL.md + checklist + extra

        # Old approval: digest set mismatch -> invalid, not silently reused.
        assert approvals.find_valid("srv", fresh) is None
        assert approvals.revoke_if_invalid("srv", fresh) is True
        decision = check_activation(
            fresh,
            skill_dir=provider.cache_dir_for(fresh),
            approval=None,
            require_approval=True,
        )
        assert decision.allowed is False


async def test_e2e_same_name_on_two_servers_coexists(tmp_path: Path) -> None:
    from agenticx.skills.unified_index import UnifiedSkillIndex

    registry_a = tmp_path / "registry-a.json"
    registry_b = tmp_path / "registry-b.json"
    RegistryStorage(registry_a).publish(
        build_registry_entry(_make_skill_dir(tmp_path / "a", "shared"))
    )
    RegistryStorage(registry_b).publish(
        build_registry_entry(
            _make_skill_dir(tmp_path / "b", "shared", checklist="# Other server\n")
        )
    )

    index = UnifiedSkillIndex(approval_store=ApprovalStore(tmp_path / "approvals.json"))
    client_a = MCPClientV2(_server_config("srv-a", registry_a))
    client_b = MCPClientV2(_server_config("srv-b", registry_b))
    async with client_a, client_b:
        index.add_provider(RemoteSkillProvider(client_a, server_id="srv-a"))
        index.add_provider(RemoteSkillProvider(client_b, server_id="srv-b"))

        matches: List = await index.find_by_name("shared")
        assert len(matches) == 2
        ids = sorted(v.skill_id for v in matches)
        assert ids == [
            "srv-a::skill://shared/SKILL.md",
            "srv-b::skill://shared/SKILL.md",
        ]

        # Removing one server's provider leaves the other entry untouched.
        index.remove_provider("srv-a")
        remaining = await index.find_by_name("shared")
        assert [v.skill_id for v in remaining] == ["srv-b::skill://shared/SKILL.md"]


async def test_e2e_out_of_manifest_read_rejected(tmp_path: Path) -> None:
    registry = _registry_path(tmp_path)
    RegistryStorage(registry).publish(
        build_registry_entry(_make_skill_dir(tmp_path, "research-sop"))
    )

    async with _provider("srv", registry) as provider:
        await provider.retain("skill://research-sop/SKILL.md")
        with pytest.raises(SkillIntegrityError, match="outside any retained"):
            await provider.read_file("skill://other-skill/SKILL.md")
        # Also a URI that merely looks related but is not in the manifest.
        with pytest.raises(SkillIntegrityError):
            await provider.read_file("skill://research-sop/references/missing.md")


async def test_e2e_cache_excluded_from_filesystem_discovery(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Cached remote bytes must never surface via filesystem discovery."""
    from agenticx.tools.skill_bundle import SkillBundleLoader

    registry = _registry_path(tmp_path)
    RegistryStorage(registry).publish(
        build_registry_entry(_make_skill_dir(tmp_path, "research-sop"))
    )
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))

    async with _provider("srv", registry) as provider:
        manifest = await provider.retain("skill://research-sop/SKILL.md")
        for uri in manifest.file_uris():
            await provider.read_file(uri)

        cache_dir = Path.home() / ".agenticx" / "skills" / "cache" / "srv" / "research-sop"
        assert (cache_dir / "SKILL.md").is_file()

        # A new host instance scanning ~/.agenticx/skills must not see it.
        loader = SkillBundleLoader(search_paths=[Path.home() / ".agenticx" / "skills"])
        discovered = {meta.name for meta in loader.scan()}
        assert "research-sop" not in discovered
