#!/usr/bin/env python3
"""Load-boundary execution-profile gate tests (runtime invariants 05).

A skill that declares a tier but no longer measures it (post-install
tampering, or a package that lied past the install gate) must not be
registered by the loader: list, read, variants, and prompt injection all
consume the same registry, so all of them stay closed. The denial is
audited to the on-disk gate sink and survives an in-memory reset.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

import pytest

from agenticx.tools.skill_bundle import SkillBundleLoader
from agenticx.utils.agx_home import agx_home

HEAVY_FILE_COUNT = 11  # > HEAVY_CODE_FILES (10, guard_classify.py:18)

SKILL_MD_TMPL = """---
name: {name}
description: demo skill for loader gate tests
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
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def test_loader_skips_mismatched_skill(tmp_path: Path) -> None:
    _write_skill(tmp_path, "good-skill")
    _write_skill(tmp_path, "bad-skill", declared="T-MD", heavy=True)

    loader = SkillBundleLoader(search_paths=[tmp_path])

    names = {s.name for s in loader.scan()}
    assert names == {"good-skill"}
    assert loader.get_skill_content("bad-skill") is None
    assert loader.get_skill("bad-skill") is None
    assert loader.get_skill_variants("bad-skill") == []


def test_loader_keeps_matching_and_undeclared(tmp_path: Path) -> None:
    _write_skill(tmp_path, "honest", declared="T-HEAVY", heavy=True)
    _write_skill(tmp_path, "legacy")

    loader = SkillBundleLoader(search_paths=[tmp_path])

    names = {s.name for s in loader.scan()}
    assert names == {"honest", "legacy"}
    content = loader.get_skill_content("honest")
    assert content is not None
    assert "Plain instructions only." in content


def test_loader_denial_is_persisted_and_survives_reset(tmp_path: Path) -> None:
    import agenticx.runtime.studio_safety as studio_safety

    _write_skill(tmp_path, "audit-skill", declared="T-MD", heavy=True)

    loader = SkillBundleLoader(search_paths=[tmp_path])
    loader.scan()

    records = _read_gate_events()
    denials = [r for r in records if r["action"] == "LOAD_DENIED"]
    assert denials, "expected a LOAD_DENIED record in the gate sink"
    assert denials[0]["tool_name"] == "audit-skill"
    assert denials[0]["stage"] == "extension_profile_gate"
    assert "boundary=load" in denials[0]["details"]
    assert "declared=T-MD" in denials[0]["details"]
    assert "measured=T-HEAVY" in denials[0]["details"]
    # "restart": in-memory state is irrelevant for the audit trail
    studio_safety._reset()
    assert _read_gate_events() == records


def test_flag_off_loader_loads_everything(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("AGX_SKILL_PROFILE_GATE", "0")
    _write_skill(tmp_path, "bad-skill", declared="T-MD", heavy=True)

    loader = SkillBundleLoader(search_paths=[tmp_path])

    names = {s.name for s in loader.scan()}
    assert names == {"bad-skill"}
    assert loader.get_skill_content("bad-skill") is not None
    assert _read_gate_events() == []
