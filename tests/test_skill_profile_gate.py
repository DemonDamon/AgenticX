#!/usr/bin/env python3
"""Execution-profile gate tests (runtime invariants 05).

Covers: declared-tier parsing, deterministic measurement, the install
rejection on the should_allow family, the registry disk-landing raise,
the AGX Bundle rejection, persistent audit records that survive restarts,
and the flag-off fallback to the pre-05 behavior. Fully closed fixtures:
skills and bundles are built in tmp paths, nothing is downloaded, and
every audit assertion reads the on-disk sinks (never in-memory state).

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

import pytest

import agenticx.extensions.installer as installer
from agenticx.extensions.installer import install_bundle, scan_bundle_source
from agenticx.extensions.registry_hub import RegistryHub
from agenticx.skills.frontmatter import get_frontmatter_scalar
from agenticx.skills.guard import (
    format_guard_rejection_message,
    scan_result_to_payload,
    scan_skill,
    should_allow,
)
from agenticx.skills.profile_gate import (
    SKILL_TIERS,
    SkillProfileMismatchError,
    measure_tier,
    read_declared_tier,
)
from agenticx.utils.agx_home import agx_home

HEAVY_FILE_COUNT = 11  # > HEAVY_CODE_FILES (10, guard_classify.py:18)

SKILL_MD_TMPL = """---
name: {name}
description: demo skill for profile gate tests
{tier_line}
---

# {name}

Plain instructions only.
"""


@pytest.fixture(autouse=True)
def _no_agx_home(monkeypatch: pytest.MonkeyPatch) -> None:
    # Keep agx_home() pointed at the conftest HOME sandbox even when the
    # local shell happens to export AGX_HOME (plan assumption #10).
    monkeypatch.delenv("AGX_HOME", raising=False)


def _write_skill(
    root: Path,
    name: str,
    *,
    declared: Optional[str] = None,
    heavy: bool = False,
) -> Path:
    tier_line = f"tier: {declared}" if declared else ""
    skill_dir = root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        SKILL_MD_TMPL.format(name=name, tier_line=tier_line), encoding="utf-8"
    )
    if heavy:
        for idx in range(HEAVY_FILE_COUNT):
            (skill_dir / f"script_{idx}.py").write_text("x = 1\n", encoding="utf-8")
    return skill_dir


def _read_gate_events() -> list[dict[str, Any]]:
    path = agx_home() / "safety" / "extension_gate.jsonl"
    if not path.is_file():
        return []
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records


# ----------------------------------------------------------------------
# primitives
# ----------------------------------------------------------------------
def test_frontmatter_scalar_helper_reads_tier() -> None:
    content = "---\nname: a\ndescription: d\ntier: T-REF\n---\nbody\n"
    assert get_frontmatter_scalar(content, "tier") == "T-REF"
    assert get_frontmatter_scalar(content, "name") == "a"
    assert get_frontmatter_scalar(content, "missing") is None


def test_declared_tier_accepts_only_the_four_tiers() -> None:
    assert SKILL_TIERS == ("T-MD", "T-LITE", "T-REF", "T-HEAVY")
    assert read_declared_tier("---\nname: a\ndescription: d\ntier: T-REF\n---\n") == "T-REF"
    assert read_declared_tier('---\nname: a\ndescription: d\ntier: "T-MD"\n---\n') == "T-MD"
    # case-insensitive: a lowercase typo is still the same declaration
    assert read_declared_tier("---\nname: a\ndescription: d\ntier: t-md\n---\n") == "T-MD"
    # unknown vocabulary: treated as undeclared (skip), never a rejection
    assert read_declared_tier("---\nname: a\ndescription: d\ntier: premium\n---\n") is None
    assert read_declared_tier("---\nname: a\ndescription: d\ntier: T_MDF\n---\n") is None
    assert read_declared_tier("---\nname: a\ndescription: d\n---\n") is None


def test_measure_tier_is_deterministic(tmp_path: Path) -> None:
    pure = _write_skill(tmp_path, "pure")
    assert measure_tier(pure) == "T-MD"
    heavy = _write_skill(tmp_path, "heavy", heavy=True)
    assert measure_tier(heavy) == "T-HEAVY"
    # The provenance sidecar the installers write is bookkeeping, not
    # skill content: it must not downgrade the measurement (T-MD -> T-LITE
    # is what compute_code_stats would do without the hidden-file staging).
    (pure / ".agx-skill-provenance.json").write_text(
        '{"source": "community"}', encoding="utf-8"
    )
    assert measure_tier(pure) == "T-MD"


# ----------------------------------------------------------------------
# install rejection: scan_skill attach + should_allow family
# ----------------------------------------------------------------------
def test_scan_skill_attaches_mismatch_profile(tmp_path: Path) -> None:
    bad = _write_skill(tmp_path, "scan-skill", declared="T-MD", heavy=True)
    result = scan_skill(bad, source="community")
    assert result.profile is not None
    assert result.profile.declared == "T-MD"
    assert result.profile.measured == "T-HEAVY"
    assert result.profile.ok is False
    assert result.profile.reason == (
        "tier mismatch: declared T-MD, measured T-HEAVY"
    )


def test_scan_result_payload_exposes_profile(tmp_path: Path) -> None:
    bad = _write_skill(tmp_path, "payload-skill", declared="T-MD", heavy=True)
    payload = scan_result_to_payload(
        scan_skill(bad, source="community"), "payload-skill"
    )
    assert payload["profile"] == {
        "declared": "T-MD",
        "measured": "T-HEAVY",
        "ok": False,
    }


def test_should_allow_blocks_tier_mismatch_unconditionally(tmp_path: Path) -> None:
    # "builtin" is the most permissive trust level: the mismatch block
    # must still fire before the trust policy, with no ack bypass.
    bad = _write_skill(tmp_path, "liar-skill", declared="T-MD", heavy=True)
    ok, reason = should_allow(scan_skill(bad, source="builtin"), "builtin")
    assert ok is False
    assert reason == "blocked: tier mismatch (declared T-MD, measured T-HEAVY)"


def test_should_allow_passes_matching_and_undeclared(tmp_path: Path) -> None:
    honest = _write_skill(tmp_path, "honest-skill", declared="T-HEAVY", heavy=True)
    ok, _ = should_allow(scan_skill(honest, source="community"), "community")
    assert ok is True
    legacy = _write_skill(tmp_path, "legacy-skill", heavy=True)
    result = scan_skill(legacy, source="community")
    assert result.profile is None
    ok, _ = should_allow(result, "community")
    assert ok is True


def test_rejection_message_mentions_tier_mismatch(tmp_path: Path) -> None:
    bad = _write_skill(tmp_path, "msg-skill", declared="T-MD", heavy=True)
    msg = format_guard_rejection_message(scan_skill(bad, source="agent-created"), action="create")
    assert "档位声明与实测不一致（声明 T-MD，实测 T-HEAVY），已拒绝。" in msg


# ----------------------------------------------------------------------
# audit: persisted on disk, survives a restart (in-memory reset)
# ----------------------------------------------------------------------
def test_install_rejection_is_persisted_and_survives_reset(tmp_path: Path) -> None:
    import agenticx.runtime.studio_safety as studio_safety

    bad = _write_skill(tmp_path, "audit-skill", declared="T-MD", heavy=True)
    ok, _ = should_allow(scan_skill(bad, source="community"), "community")
    assert ok is False
    records = _read_gate_events()
    assert any(r["action"] == "INSTALL_REJECTED" for r in records)
    # "restart": drop every in-memory structure, the file must be unchanged
    studio_safety._reset()
    assert _read_gate_events() == records
    # the record went to the dedicated gate sink, not the pipeline sink
    pipeline_path = agx_home() / "safety" / "events.jsonl"
    if pipeline_path.is_file():
        assert "INSTALL_REJECTED" not in pipeline_path.read_text(encoding="utf-8")


def test_gate_record_shape(tmp_path: Path) -> None:
    bad = _write_skill(tmp_path, "shape-skill", declared="T-MD", heavy=True)
    ok, _ = should_allow(scan_skill(bad, source="community"), "community")
    assert ok is False
    rec = [r for r in _read_gate_events() if r["action"] == "INSTALL_REJECTED"][-1]
    assert rec["stage"] == "extension_profile_gate"
    assert rec["rule_ids"] == ["tier_mismatch"]
    assert rec["severity"] == "WARN"
    assert rec["mode"] == "enforce"
    assert "declared=T-MD" in rec["details"]
    assert "measured=T-HEAVY" in rec["details"]
    assert "boundary=install_skill" in rec["details"]
    assert rec["ts"]


def test_enterprise_outbox_mirror_for_gate_rejections(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.cli.config_manager import ConfigManager

    values = {"enterprise.enabled": True, "enterprise.token": "agx-pat-test"}

    def get_value(cls: object, key: str) -> object:
        del cls
        return values.get(key)

    monkeypatch.setattr(ConfigManager, "get_value", classmethod(get_value))

    bad = _write_skill(tmp_path, "mirror-skill", declared="T-MD", heavy=True)
    ok, _ = should_allow(scan_skill(bad, source="community"), "community")
    assert ok is False
    outbox = agx_home() / "action_audit" / "outbox.jsonl"
    assert outbox.is_file()
    line = json.loads(outbox.read_text(encoding="utf-8").splitlines()[0])
    assert line["kind"] == "safety_event"
    assert line["subject"] == "extension_profile_gate:INSTALL_REJECTED"
    assert line["decision_source"] == "studio_safety/enforce"
    assert "tier_mismatch" in line["summary"]


# ----------------------------------------------------------------------
# flag off: byte-for-byte pre-05 behavior
# ----------------------------------------------------------------------
def test_flag_off_disables_the_gate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_SKILL_PROFILE_GATE", "0")
    bad = _write_skill(tmp_path, "legacy-heavy", declared="T-MD", heavy=True)
    result = scan_skill(bad, source="community")
    assert result.profile is None
    ok, _ = should_allow(result, "community")
    assert ok is True  # benign content, community-safe verdict, no gate
    hub = RegistryHub()
    src = _write_skill(tmp_path, "registry-ok", declared="T-MD", heavy=True)
    md = hub.write_registry_skill_dir("registry-ok", src)  # no raise, writes
    assert Path(md).is_file()
    assert _read_gate_events() == []


# ----------------------------------------------------------------------
# registry disk-landing family (covers clawhub tool, studio
# /api/registry/install, SkillHub, AGX native registry)
# ----------------------------------------------------------------------
def test_write_registry_skill_dir_raises_on_mismatch(tmp_path: Path) -> None:
    hub = RegistryHub()
    src = _write_skill(tmp_path, "reg-liar", declared="T-MD", heavy=True)
    # a previous install must survive the rejection untouched
    target = Path.home() / ".agenticx" / "skills" / "registry" / "reg-liar"
    target.mkdir(parents=True, exist_ok=True)
    (target / "SKILL.md").write_text("old content", encoding="utf-8")

    with pytest.raises(SkillProfileMismatchError, match="tier mismatch: declared T-MD, measured T-HEAVY"):
        hub.write_registry_skill_dir("reg-liar", src, source="community")

    assert (target / "SKILL.md").read_text(encoding="utf-8") == "old content"
    records = _read_gate_events()
    assert any(
        r["action"] == "INSTALL_REJECTED" and r["tool_name"] == "reg-liar"
        for r in records
    )


def test_write_registry_md_only_raises_on_mismatch(tmp_path: Path) -> None:
    hub = RegistryHub()
    content = (
        "---\nname: md-liar\ndescription: d\ntier: T-MD\n---\n\n"
        "# md-liar\n\n```bash\nwget http://example.com/pkg\ncd src\n```\n"
    )
    with pytest.raises(SkillProfileMismatchError, match="tier mismatch: declared T-MD, measured T-REF"):
        hub.write_registry_skill("md-liar", content, source="community")
    assert not (
        Path.home() / ".agenticx" / "skills" / "registry" / "md-liar"
    ).exists()


def test_registry_write_accepts_consistent_skill(tmp_path: Path) -> None:
    hub = RegistryHub()
    src = _write_skill(tmp_path, "reg-honest", declared="T-HEAVY", heavy=True)
    md = hub.write_registry_skill_dir("reg-honest", src, source="community")
    assert Path(md).is_file()


# ----------------------------------------------------------------------
# AGX Bundle family
# ----------------------------------------------------------------------
def _make_bundle(root: Path, *, declared: Optional[str], heavy: bool) -> Path:
    bdir = root / "demo-bundle"
    skill = bdir / "skills" / "demo-skill"
    skill.mkdir(parents=True)
    tier_line = f"tier: {declared}" if declared else ""
    (skill / "SKILL.md").write_text(
        f"---\nname: demo-skill\ndescription: demo bundle skill\n{tier_line}\n---\n\n"
        "# demo-skill\n\nPlain instructions only.\n",
        encoding="utf-8",
    )
    if heavy:
        for idx in range(HEAVY_FILE_COUNT):
            (skill / f"script_{idx}.py").write_text("x = 1\n", encoding="utf-8")
    (bdir / "agx-bundle.yaml").write_text(
        "agx_bundle: \"1.0\"\n"
        "name: demo-bundle\n"
        "version: \"1.0.0\"\n"
        "description: demo\n"
        "components:\n"
        "  skills:\n"
        "    - path: skills/demo-skill/SKILL.md\n",
        encoding="utf-8",
    )
    return bdir


def _patch_installer_home(monkeypatch: pytest.MonkeyPatch, root: Path) -> None:
    # installer.py resolves its paths at import time (module constants);
    # point every one of them at a fresh sandbox for this test.
    home = root / "agx-home"
    home.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(installer, "_AGENTICX_HOME", home)
    monkeypatch.setattr(installer, "_BUNDLES_JSON", home / "bundles.json")
    monkeypatch.setattr(installer, "_SKILLS_BUNDLES_DIR", home / "skills" / "bundles")
    monkeypatch.setattr(installer, "_AVATARS_PRESETS_DIR", home / "avatars" / "presets")
    monkeypatch.setattr(
        installer, "_MEMORY_TEMPLATES_DIR", home / "workspace" / "memory_templates"
    )
    monkeypatch.setattr(installer, "_MCP_JSON", home / "mcp.json")


def test_bundle_scan_reports_profile_rejects(tmp_path: Path) -> None:
    bdir = _make_bundle(tmp_path, declared="T-MD", heavy=True)
    scan = scan_bundle_source(bdir)
    assert scan["ok"] is True
    assert scan["profile_rejects"] == [
        {"skill": "demo-skill", "declared": "T-MD", "measured": "T-HEAVY"}
    ]
    # the per-skill payload exposes the same fact for API/UI consumers
    assert scan["skills"][0]["profile"] == {
        "declared": "T-MD",
        "measured": "T-HEAVY",
        "ok": False,
    }


def test_install_bundle_rejects_mismatch_and_writes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_installer_home(monkeypatch, tmp_path)
    bdir = _make_bundle(tmp_path, declared="T-MD", heavy=True)

    result = install_bundle(bdir)

    assert result.success is False
    assert result.error_code == "tier_mismatch"
    assert result.error == (
        "tier mismatch: demo-skill (declared T-MD, measured T-HEAVY)"
    )
    assert not (installer._SKILLS_BUNDLES_DIR / "demo-bundle").exists()
    assert not installer._BUNDLES_JSON.exists()
    assert not installer._MCP_JSON.exists()
    records = _read_gate_events()
    assert any(
        r["action"] == "BUNDLE_REJECTED" and r["tool_name"] == "demo-skill"
        for r in records
    )


def test_install_bundle_accepts_consistent_bundle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_installer_home(monkeypatch, tmp_path)
    bdir = _make_bundle(tmp_path, declared="T-MD", heavy=False)

    result = install_bundle(bdir)

    assert result.success is True
    assert result.skills_installed == ["demo-skill"]
    assert (installer._SKILLS_BUNDLES_DIR / "demo-bundle" / "demo-skill" / "SKILL.md").is_file()


# ----------------------------------------------------------------------
# GitHub tarball family: acknowledge_high_risk must not bypass a tier block
# ----------------------------------------------------------------------
def _tier_tarball() -> bytes:
    import io
    import tarfile

    skill_md = (
        "---\nname: liar-heavy\ndescription: demo\ntier: T-MD\n---\n\n"
        "# Liar\n\n"
        "Setup: placeholder text only\n"
    ).encode("utf-8")
    members: list[tuple[str, Optional[bytes]]] = [
        ("skills", None),
        ("skills/liar-heavy", None),
        ("skills/liar-heavy/SKILL.md", skill_md),
    ]
    members += [
        (f"skills/liar-heavy/script_{idx}.py", b"x = 1\n")
        for idx in range(HEAVY_FILE_COUNT)
    ]
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, content in members:
            info = tarfile.TarInfo(name=f"fakerepo-main/{name}")
            if content is None:
                info.type = tarfile.DIRTYPE
                tf.addfile(info)
            else:
                info.size = len(content)
                tf.addfile(info, io.BytesIO(content))
    return buf.getvalue()


def test_github_tarball_tier_mismatch_blocks_even_with_ack(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.skills.import_repo import install_skill_full_from_repo

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(
        "agenticx.skills.import_repo._download_tarball",
        lambda owner, name, branch: _tier_tarball(),
    )

    result = install_skill_full_from_repo(
        repo="owner/fakerepo",
        skill="liar-heavy",
        acknowledge_high_risk=True,
    )

    assert result.installed == []
    assert [r["name"] for r in result.rejected_by_guard] == ["liar-heavy"]
    assert "tier mismatch" in result.rejected_by_guard[0]["reason"]
    target = tmp_path / ".agenticx" / "skills" / "registry" / "liar-heavy"
    assert not target.exists()
    assert any(r["action"] == "INSTALL_REJECTED" for r in _read_gate_events())

