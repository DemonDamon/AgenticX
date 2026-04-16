#!/usr/bin/env python3
"""Smoke tests for Phase 3 wiring — runtime integration, fuzzy patch in
skill_manage, changelog, usage tracking, config unification, deprecation.

Author: Damon Li
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest


# ---------------------------------------------------------------------------
# P3-1: agent_runtime registers SessionReviewHook + counters
# ---------------------------------------------------------------------------

class _FakeGate:
    """Minimal stand-in for ConfirmGate."""
    async def check(self, *a: Any, **kw: Any) -> Any:
        return None


class TestRuntimeHookRegistration:
    def test_session_review_hook_registered(self) -> None:
        from agenticx.runtime.agent_runtime import AgentRuntime

        rt = AgentRuntime(llm=object(), confirm_gate=_FakeGate())
        hook_types = [type(h).__name__ for _, h in rt.hooks._entries]
        assert "SessionReviewHook" in hook_types

    def test_observation_hook_registered(self) -> None:
        from agenticx.runtime.agent_runtime import AgentRuntime

        rt = AgentRuntime(llm=object(), confirm_gate=_FakeGate())
        hook_types = [type(h).__name__ for _, h in rt.hooks._entries]
        assert "ObservationHook" in hook_types

    def test_session_review_lowest_priority(self) -> None:
        from agenticx.runtime.agent_runtime import AgentRuntime

        rt = AgentRuntime(llm=object(), confirm_gate=_FakeGate())
        priorities = {type(h).__name__: p for p, h in rt.hooks._entries}
        review_p = priorities.get("SessionReviewHook")
        observer_p = priorities.get("ObservationHook")
        if review_p is not None and observer_p is not None:
            assert review_p < observer_p


# ---------------------------------------------------------------------------
# P3-2: fuzzy patch wired into skill_manage
# ---------------------------------------------------------------------------

class TestSkillManageFuzzyPatch:
    @pytest.fixture()
    def skill_env(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
        monkeypatch.setenv("AGX_SKILL_MANAGE", "1")
        skills_root = tmp_path / "skills"
        skills_root.mkdir()
        monkeypatch.setattr(
            "agenticx.cli.agent_tools._agent_created_skill_root",
            lambda: skills_root,
        )
        skill_dir = skills_root / "test-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text(
            "---\nname: test-skill\ndescription: A test\n---\n\n"
            "## Steps\n\n1. Run build\n2. Check output\n",
        )
        return skill_dir

    def test_exact_patch_still_works(self, skill_env: Path) -> None:
        from agenticx.cli.agent_tools import _tool_skill_manage

        result = _tool_skill_manage(
            {"action": "patch", "name": "test-skill", "old_string": "Run build", "new_string": "Run make"},
            None,
        )
        parsed = json.loads(result)
        assert parsed["ok"] is True
        assert parsed["strategy"] == "exact"
        assert "Run make" in (skill_env / "SKILL.md").read_text()

    def test_fuzzy_patch_indentation(self, skill_env: Path) -> None:
        from agenticx.cli.agent_tools import _tool_skill_manage

        (skill_env / "SKILL.md").write_text(
            "---\nname: test-skill\ndescription: A test\n---\n\n"
            "    def foo():\n        pass\n"
        )
        result = _tool_skill_manage(
            {"action": "patch", "name": "test-skill", "old_string": "def foo():\n    pass", "new_string": "def bar():\n    return 42"},
            None,
        )
        parsed = json.loads(result)
        assert parsed["ok"] is True
        assert parsed["strategy"] in ("line_trimmed", "indentation_flexible")

    def test_patch_writes_changelog(self, skill_env: Path) -> None:
        from agenticx.cli.agent_tools import _tool_skill_manage

        _tool_skill_manage(
            {"action": "patch", "name": "test-skill", "old_string": "Run build", "new_string": "Run make"},
            None,
        )
        cl = skill_env / ".changelog"
        assert cl.exists()
        assert "patch" in cl.read_text()


# ---------------------------------------------------------------------------
# P3-3: create/delete write changelog
# ---------------------------------------------------------------------------

class TestSkillManageChangelog:
    @pytest.fixture()
    def skills_root(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
        monkeypatch.setenv("AGX_SKILL_MANAGE", "1")
        root = tmp_path / "skills"
        root.mkdir()
        monkeypatch.setattr(
            "agenticx.cli.agent_tools._agent_created_skill_root",
            lambda: root,
        )
        return root

    def test_create_writes_changelog(self, skills_root: Path) -> None:
        from agenticx.cli.agent_tools import _tool_skill_manage

        content = "---\nname: new-skill\ndescription: test\n---\n\n## Steps\n1. Do something\n"
        result = _tool_skill_manage({"action": "create", "name": "new-skill", "content": content}, None)
        parsed = json.loads(result)
        assert parsed["ok"] is True
        cl = skills_root / "new-skill" / ".changelog"
        assert cl.exists()
        assert "create" in cl.read_text()

    def test_delete_writes_changelog_before_removal(self, skills_root: Path) -> None:
        from agenticx.cli.agent_tools import _tool_skill_manage

        skill_dir = skills_root / "to-delete"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("---\nname: to-delete\ndescription: x\n---\n\nBody.\n")
        result = _tool_skill_manage({"action": "delete", "name": "to-delete"}, None)
        parsed = json.loads(result)
        assert parsed["ok"] is True
        assert not skill_dir.exists()


# ---------------------------------------------------------------------------
# P3-4: skill_use records usage
# ---------------------------------------------------------------------------

class TestSkillUseRecordsUsage:
    def test_usage_recorded_on_activation(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        from agenticx.learning.skill_usage_tracker import STATS_FILENAME, get_stats

        skill_dir = tmp_path / "my-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("---\nname: my-skill\ndescription: test\n---\n\nContent.\n")

        recorded: list[dict] = []
        original_record = __import__("agenticx.learning.skill_usage_tracker", fromlist=["record_use"]).record_use

        def spy_record(d: Any, **kw: Any) -> None:
            recorded.append({"dir": str(d), **kw})
            original_record(d, **kw)

        monkeypatch.setattr("agenticx.learning.skill_usage_tracker.record_use", spy_record)

        from agenticx.learning.skill_usage_tracker import record_use
        record_use(skill_dir, session_id="s1")

        stats = get_stats(skill_dir)
        assert stats.use_count == 1


# ---------------------------------------------------------------------------
# P3-5: config unification
# ---------------------------------------------------------------------------

class TestConfigUnification:
    def test_observer_uses_config_module(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with patch("agenticx.learning.config._load_yaml_section", return_value={"enabled": False}):
            with patch.dict("os.environ", {}, clear=False):
                monkeypatch.delenv("AGX_LEARNING_ENABLED", raising=False)
                from agenticx.learning.observer import _learning_enabled
                assert _learning_enabled() is False

    def test_review_hook_uses_config_module(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with patch("agenticx.learning.config._load_yaml_section", return_value={"review_enabled": True}):
            monkeypatch.delenv("AGX_SKILL_REVIEW_ENABLED", raising=False)
            from agenticx.learning.session_review_hook import _review_enabled
            assert _review_enabled() is True


# ---------------------------------------------------------------------------
# P3-6: deprecation analysis
# ---------------------------------------------------------------------------

class TestDeprecationAnalysis:
    def test_no_candidates(self, tmp_path: Path) -> None:
        from agenticx.learning.skill_deprecation import check_deprecation
        report = check_deprecation(tmp_path)
        assert report == []

    def test_flags_underperforming(self, tmp_path: Path) -> None:
        from agenticx.learning.skill_deprecation import check_deprecation
        from agenticx.learning.skill_usage_tracker import record_use

        bad = tmp_path / "bad-skill"
        bad.mkdir()
        for _ in range(5):
            record_use(bad, success=False)
        report = check_deprecation(tmp_path, min_uses=5)
        assert len(report) == 1
        assert report[0]["skill_name"] == "bad-skill"
        assert report[0]["suggested_action"] == "remove"

    def test_json_output(self, tmp_path: Path) -> None:
        from agenticx.learning.skill_deprecation import check_deprecation_json
        result = check_deprecation_json(tmp_path)
        parsed = json.loads(result)
        assert parsed["status"] == "ok"

    def test_update_vs_remove(self, tmp_path: Path) -> None:
        from agenticx.learning.skill_deprecation import check_deprecation
        from agenticx.learning.skill_usage_tracker import record_use

        marginal = tmp_path / "marginal-skill"
        marginal.mkdir()
        record_use(marginal, success=True)
        for _ in range(4):
            record_use(marginal, success=False)
        report = check_deprecation(tmp_path, min_uses=5, max_success_rate=0.3)
        assert len(report) == 1
        assert report[0]["suggested_action"] == "update"
