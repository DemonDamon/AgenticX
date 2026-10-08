"""Tests for AGX Bundle MCP skill sources (SP3, SEP-2640).

Covers: agx-bundle.yaml `mcp:` skill refs (parse + validation), mixed
local/remote installs with the fetch → stage → scan → approve → registry
chain, unreachable-server failure messages, and a real fetch against a
stdio skills server.
"""

from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path

import pytest

from agenticx.extensions.bundle import BundleParseError, parse_bundle_manifest
from agenticx.extensions.installer import (
    FetchedRemoteSkill,
    McpSkillFetcher,
    install_bundle,
)
from agenticx.skills.manifest import (
    SkillFileEntry,
    SkillManifest,
    compute_digest,
)

_REPO_ROOT = Path(__file__).resolve().parents[1]

_LOCAL_SKILL_MD = (
    "---\nname: local-sop\ndescription: Local SOP\n---\n\n"
    "# Local SOP\n\nStep-by-step research flow.\n"
)

_REMOTE_SKILL_MD = (
    "---\nname: remote-demo\ndescription: Remote demo\n---\n\n"
    "# Remote Demo\n\nSee the checklist.\n"
)
_REMOTE_CHECKLIST = "- step one\n- step two\n"


def _make_remote_skill(
    server: str = "skills-src",
    name: str = "remote-demo",
) -> FetchedRemoteSkill:
    files = {
        "SKILL.md": _REMOTE_SKILL_MD.encode("utf-8"),
        "references/checklist.md": _REMOTE_CHECKLIST.encode("utf-8"),
    }
    resources = [
        SkillFileEntry(
            uri=f"skill://{name}/{rel}",
            digest=compute_digest(raw),
            size=len(raw),
        )
        for rel, raw in files.items()
    ]
    manifest = SkillManifest(
        uri=f"skill://{name}/SKILL.md",
        frontmatter={"name": name, "description": "Remote demo"},
        resources=resources,
    )
    return FetchedRemoteSkill(server=server, manifest=manifest, files=files)


def _make_bundle_dir(tmp_path: Path, *, remote: bool = True) -> Path:
    bundle_dir = tmp_path / "mixed-kit"
    skill_dir = bundle_dir / "skills" / "local-sop"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(_LOCAL_SKILL_MD, encoding="utf-8")

    skills_block = "        - path: skills/local-sop/SKILL.md\n          description: Local SOP\n"
    if remote:
        skills_block += (
            "        - mcp:\n"
            "            server: skills-src\n"
            "            uri: skill://remote-demo/SKILL.md\n"
            "          description: Remote demo\n"
        )
    (bundle_dir / "agx-bundle.yaml").write_text(
        (
            'agx_bundle: "1.0"\n'
            "name: mixed-kit\n"
            "version: 1.0.0\n"
            "description: Mixed local and remote skills\n"
            "author: test\n"
            "components:\n"
            "  skills:\n"
            f"{skills_block}"
        ),
        encoding="utf-8",
    )
    return bundle_dir


@pytest.fixture
def installer_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    import agenticx.extensions.installer as installer

    agx = home / ".agenticx"
    monkeypatch.setattr(installer, "_AGENTICX_HOME", agx)
    monkeypatch.setattr(installer, "_BUNDLES_JSON", agx / "bundles.json")
    monkeypatch.setattr(
        installer, "_SKILLS_BUNDLES_DIR", agx / "skills" / "bundles"
    )
    monkeypatch.setattr(
        installer, "_AVATARS_PRESETS_DIR", agx / "avatars" / "presets"
    )
    monkeypatch.setattr(
        installer, "_MEMORY_TEMPLATES_DIR", agx / "workspace" / "memory_templates"
    )
    monkeypatch.setattr(installer, "_MCP_JSON", agx / "mcp.json")
    return home


# ------------------------------------------------------------------- parsing


def test_parse_bundle_with_mcp_skill_ref(tmp_path: Path) -> None:
    bundle_dir = _make_bundle_dir(tmp_path)
    manifest = parse_bundle_manifest(bundle_dir)

    assert len(manifest.skills) == 2
    local, remote = manifest.skills
    assert local.path == "skills/local-sop/SKILL.md"
    assert not local.is_remote
    assert remote.is_remote
    assert remote.mcp == {"server": "skills-src", "uri": "skill://remote-demo/SKILL.md"}

    payload = manifest.to_dict()
    assert payload["components"]["skills"][1]["mcp"]["server"] == "skills-src"


def test_parse_rejects_path_and_mcp_together(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "both"
    bundle_dir.mkdir()
    (bundle_dir / "agx-bundle.yaml").write_text(
        (
            'agx_bundle: "1.0"\nname: both\n'
            "components:\n"
            "  skills:\n"
            "    - path: skills/x/SKILL.md\n"
            "      mcp:\n"
            "        server: s\n"
            "        uri: skill://x/SKILL.md\n"
        ),
        encoding="utf-8",
    )
    with pytest.raises(BundleParseError, match="mutually exclusive"):
        parse_bundle_manifest(bundle_dir)


def test_parse_rejects_missing_path_and_mcp(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "neither"
    bundle_dir.mkdir()
    (bundle_dir / "agx-bundle.yaml").write_text(
        'agx_bundle: "1.0"\nname: neither\ncomponents:\n  skills:\n    - description: d\n',
        encoding="utf-8",
    )
    with pytest.raises(BundleParseError, match="'path' or 'mcp' is required"):
        parse_bundle_manifest(bundle_dir)


def test_parse_rejects_incomplete_mcp_ref(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "half"
    bundle_dir.mkdir()
    (bundle_dir / "agx-bundle.yaml").write_text(
        (
            'agx_bundle: "1.0"\nname: half\n'
            "components:\n"
            "  skills:\n"
            "    - mcp:\n"
            "        server: s\n"
        ),
        encoding="utf-8",
    )
    with pytest.raises(BundleParseError, match="'server' and 'uri'"):
        parse_bundle_manifest(bundle_dir)


# ------------------------------------------------------------------- install


def test_install_mixed_bundle_local_and_remote(
    installer_home: Path, tmp_path: Path
) -> None:
    bundle_dir = _make_bundle_dir(tmp_path)
    result = install_bundle(bundle_dir, skill_fetcher=lambda s, u: _make_remote_skill(s))
    assert result.success is True
    assert sorted(result.skills_installed) == ["local-sop", "remote-demo"]

    bundles_root = installer_home / ".agenticx" / "skills" / "bundles" / "mixed-kit"
    assert (bundles_root / "local-sop" / "SKILL.md").is_file()
    remote_installed = bundles_root / "remote-demo"
    assert (remote_installed / "SKILL.md").is_file()
    assert (remote_installed / "references" / "checklist.md").read_text(
        encoding="utf-8"
    ) == _REMOTE_CHECKLIST

    # Verified bytes are staged into the (discovery-excluded) skill cache.
    cache_skill = (
        installer_home / ".agenticx" / "skills" / "cache" / "skills-src" / "remote-demo"
    )
    cached_md = cache_skill / "SKILL.md"
    assert cached_md.is_file()
    # Cache files are read-only.
    mode = stat.S_IMODE(cached_md.stat().st_mode)
    assert not (mode & stat.S_IWUSR)

    # Approval bound to the fetched digest set.
    approvals = json.loads(
        (installer_home / ".agenticx" / "skills" / "approvals.json").read_text(
            encoding="utf-8"
        )
    )
    key = "skills-src::skill://remote-demo/SKILL.md"
    assert key in approvals
    assert approvals[key]["origin"] == "mcp"
    assert approvals[key]["file_digests"]["skill://remote-demo/SKILL.md"] == (
        compute_digest(_REMOTE_SKILL_MD.encode("utf-8"))
    )

    # Registry entry with a full manifest, origin="mcp".
    from agenticx.skills.registry import RegistryStorage

    entry = RegistryStorage().get_latest("remote-demo", origin="mcp")
    assert entry is not None
    assert [f["path"] for f in entry.files] == [
        "SKILL.md",
        "references/checklist.md",
    ]

    # The install is recorded in bundles.json.
    record = json.loads(
        (installer_home / ".agenticx" / "bundles.json").read_text(encoding="utf-8")
    )
    assert sorted(record["bundles"]["mixed-kit"]["skills"]) == [
        "local-sop",
        "remote-demo",
    ]


def test_install_remote_skill_unreachable_has_clear_error(
    installer_home: Path, tmp_path: Path
) -> None:
    bundle_dir = _make_bundle_dir(tmp_path)

    def _unreachable(server: str, uri: str) -> FetchedRemoteSkill:
        raise ConnectionError("connection refused")

    result = install_bundle(bundle_dir, skill_fetcher=_unreachable)
    assert result.success is False
    assert "skill://remote-demo/SKILL.md" in result.error
    assert "skills-src" in result.error
    assert "connection refused" in result.error


def test_install_remote_skill_without_mcp_config_fails(
    installer_home: Path, tmp_path: Path
) -> None:
    bundle_dir = _make_bundle_dir(tmp_path)
    # No skill_fetcher: install_bundle falls back to McpSkillFetcher over the
    # (missing) ~/.agenticx/mcp.json.
    result = install_bundle(bundle_dir)
    assert result.success is False
    assert "skills-src" in result.error
    assert "not configured" in result.error


def test_install_dangerous_remote_skill_requires_acknowledgement(
    installer_home: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.skills.guard_types import ScanResult

    bundle_dir = _make_bundle_dir(tmp_path)

    def _dangerous_scan(skill_dir, **kwargs):
        return ScanResult(verdict="dangerous", source="community")

    monkeypatch.setattr(
        "agenticx.skills.guard.scan_skill_deep", _dangerous_scan
    )

    blocked = install_bundle(bundle_dir, skill_fetcher=lambda s, u: _make_remote_skill(s))
    assert blocked.success is False
    assert blocked.error_code == "high_risk_confirm_required"

    acknowledged = install_bundle(
        bundle_dir,
        acknowledge_high_risk=True,
        skill_fetcher=lambda s, u: _make_remote_skill(s),
    )
    assert acknowledged.success is True


def test_install_replaces_existing_remote_skill(
    installer_home: Path, tmp_path: Path
) -> None:
    bundle_dir = _make_bundle_dir(tmp_path)
    fetcher = lambda s, u: _make_remote_skill(s)  # noqa: E731
    assert install_bundle(bundle_dir, skill_fetcher=fetcher).success is True

    # Re-install: destination is replaced, registry bumps the patch version.
    second = install_bundle(bundle_dir, skill_fetcher=fetcher)
    assert second.success is True

    from agenticx.skills.registry import RegistryStorage

    rows = [e for e in RegistryStorage().list_entries() if e.origin == "mcp"]
    assert sorted(e.version for e in rows) == ["0.1.0", "0.1.1"]


# ------------------------------------------------------- real fetch (stdio MCP)


def test_mcp_skill_fetcher_pulls_from_stdio_server(
    installer_home: Path, tmp_path: Path
) -> None:
    import subprocess

    registry_path = tmp_path / "server-registry.json"
    skill_md = (
        "---\nname: served-skill\ndescription: Served\n---\n\n# Served\n\nHello.\n"
    )
    registry_path.write_text(
        json.dumps(
            {
                "skills": {
                    "served-skill": [
                        {
                            "name": "served-skill",
                            "version": "0.1.0",
                            "skill_content": skill_md,
                        }
                    ]
                }
            }
        ),
        encoding="utf-8",
    )

    mcp_json = installer_home / ".agenticx" / "mcp.json"
    mcp_json.parent.mkdir(parents=True, exist_ok=True)
    mcp_json.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "skills-src": {
                        "command": sys.executable,
                        "args": [
                            "-m",
                            "agenticx.skills.mcp_server",
                            "--registry",
                            str(registry_path),
                        ],
                        "env": {
                            "PYTHONPATH": str(_REPO_ROOT),
                            **{
                                k: v
                                for k, v in os.environ.items()
                                if k.endswith("_proxy") or k == "NO_PROXY"
                            },
                        },
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    fetcher = McpSkillFetcher()
    fetched = fetcher.fetch("skills-src", "skill://served-skill/SKILL.md")
    assert fetched.skill_name == "served-skill"
    assert fetched.files["SKILL.md"].decode("utf-8") == skill_md

    # And the whole bundle install works through the real fetcher.
    bundle_dir = tmp_path / "remote-only"
    bundle_dir.mkdir()
    (bundle_dir / "agx-bundle.yaml").write_text(
        (
            'agx_bundle: "1.0"\nname: remote-only\n'
            "components:\n"
            "  skills:\n"
            "    - mcp:\n"
            "        server: skills-src\n"
            "        uri: skill://served-skill/SKILL.md\n"
        ),
        encoding="utf-8",
    )
    result = install_bundle(bundle_dir, skill_fetcher=McpSkillFetcher())
    assert result.success is True
    assert result.skills_installed == ["served-skill"]
    assert (
        installer_home
        / ".agenticx"
        / "skills"
        / "bundles"
        / "remote-only"
        / "served-skill"
        / "SKILL.md"
    ).is_file()
