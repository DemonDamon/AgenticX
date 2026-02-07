"""
Smoke tests for SkillGate (OpenClaw-inspired skill eligibility gating).

Validates:
- OS gate (match / mismatch)
- requires_bins (present / missing)
- requires_any_bins
- requires_env (set / unset)
- always=True bypass
- Empty gate passes by default
- _parse_gate_from_frontmatter extraction
- Integration with SkillBundleLoader._check_gate
"""

import os
import platform
import pytest

from agenticx.tools.skill_bundle import SkillGate, check_skill_gate, SkillBundleLoader


class TestCheckSkillGate:
    """Unit tests for the check_skill_gate function."""

    def test_empty_gate_passes(self):
        """Empty gate (no constraints) should always pass."""
        gate = SkillGate()
        assert check_skill_gate(gate) is True

    def test_always_true(self):
        """always=True bypasses all other checks."""
        gate = SkillGate(
            always=True,
            os=["nonexistent_os"],
            requires_bins=["nonexistent_bin_xyz_123"],
            requires_env=["NONEXISTENT_ENV_VAR_XYZ"],
        )
        assert check_skill_gate(gate) is True

    def test_os_match(self):
        """Current OS in the list -> pass."""
        current_os = platform.system().lower()  # e.g. "darwin", "linux", "windows"
        gate = SkillGate(os=[current_os, "other_os"])
        assert check_skill_gate(gate) is True

    def test_os_mismatch(self):
        """Current OS not in the list -> fail."""
        gate = SkillGate(os=["nonexistent_os_xyz"])
        assert check_skill_gate(gate) is False

    def test_requires_bins_present(self):
        """All bins exist on PATH -> pass.  'python3' or 'python' should exist."""
        # Use a bin we know exists in CI and local
        gate = SkillGate(requires_bins=["python3"])
        # Fallback: if python3 not found, try python
        import shutil
        if shutil.which("python3") is None:
            gate = SkillGate(requires_bins=["python"])
        assert check_skill_gate(gate) is True

    def test_requires_bins_missing(self):
        """A missing bin -> fail."""
        gate = SkillGate(requires_bins=["nonexistent_binary_xyz_999"])
        assert check_skill_gate(gate) is False

    def test_requires_any_bins_one_present(self):
        """At least one bin exists -> pass."""
        gate = SkillGate(requires_any_bins=["nonexistent_xyz", "python3", "also_missing"])
        import shutil
        if shutil.which("python3") is None:
            gate = SkillGate(requires_any_bins=["nonexistent_xyz", "python", "also_missing"])
        assert check_skill_gate(gate) is True

    def test_requires_any_bins_none_present(self):
        """No bin exists -> fail."""
        gate = SkillGate(requires_any_bins=["missing_a_xyz", "missing_b_xyz"])
        assert check_skill_gate(gate) is False

    def test_requires_env_set(self):
        """All env vars set -> pass."""
        os.environ["_AGENTICX_TEST_GATE_VAR"] = "1"
        try:
            gate = SkillGate(requires_env=["_AGENTICX_TEST_GATE_VAR"])
            assert check_skill_gate(gate) is True
        finally:
            del os.environ["_AGENTICX_TEST_GATE_VAR"]

    def test_requires_env_unset(self):
        """Missing env var -> fail."""
        # Make sure it's not set
        os.environ.pop("_AGENTICX_TEST_GATE_MISSING", None)
        gate = SkillGate(requires_env=["_AGENTICX_TEST_GATE_MISSING"])
        assert check_skill_gate(gate) is False

    def test_combined_pass(self):
        """Multiple constraints all satisfied -> pass."""
        current_os = platform.system().lower()
        os.environ["_AGENTICX_TEST_GATE_COMBO"] = "yes"
        try:
            gate = SkillGate(
                os=[current_os],
                requires_env=["_AGENTICX_TEST_GATE_COMBO"],
            )
            assert check_skill_gate(gate) is True
        finally:
            del os.environ["_AGENTICX_TEST_GATE_COMBO"]

    def test_combined_partial_fail(self):
        """One constraint fails -> whole gate fails (AND logic)."""
        current_os = platform.system().lower()
        gate = SkillGate(
            os=[current_os],
            requires_bins=["nonexistent_binary_xyz_999"],
        )
        assert check_skill_gate(gate) is False


class TestParseGateFromFrontmatter:
    """Tests for SkillBundleLoader._parse_gate_from_frontmatter."""

    def test_no_gate_fields(self):
        content = "---\nname: test\ndescription: A test\n---\n# Body"
        gate = SkillBundleLoader._parse_gate_from_frontmatter(content)
        assert gate.os == []
        assert gate.requires_bins == []
        assert gate.always is False

    def test_parse_os(self):
        content = '---\nname: test\nos: ["linux", "darwin"]\n---\n'
        gate = SkillBundleLoader._parse_gate_from_frontmatter(content)
        assert gate.os == ["linux", "darwin"]

    def test_parse_requires_bins(self):
        content = '---\nname: test\nrequires_bins: ["git", "docker"]\n---\n'
        gate = SkillBundleLoader._parse_gate_from_frontmatter(content)
        assert gate.requires_bins == ["git", "docker"]

    def test_parse_requires_env(self):
        content = '---\nname: test\nrequires_env: ["API_KEY"]\n---\n'
        gate = SkillBundleLoader._parse_gate_from_frontmatter(content)
        assert gate.requires_env == ["API_KEY"]

    def test_parse_always_true(self):
        content = "---\nname: test\nalways: true\n---\n"
        gate = SkillBundleLoader._parse_gate_from_frontmatter(content)
        assert gate.always is True

    def test_parse_always_false(self):
        content = "---\nname: test\nalways: false\n---\n"
        gate = SkillBundleLoader._parse_gate_from_frontmatter(content)
        assert gate.always is False

    def test_no_frontmatter(self):
        content = "# Just markdown, no frontmatter"
        gate = SkillBundleLoader._parse_gate_from_frontmatter(content)
        assert gate == SkillGate()


class TestLoaderCheckGate:
    """Test that SkillBundleLoader._check_gate delegates correctly."""

    def test_delegates_to_module_function(self):
        gate = SkillGate(always=True)
        assert SkillBundleLoader._check_gate(gate) is True

        gate2 = SkillGate(os=["nonexistent_os"])
        assert SkillBundleLoader._check_gate(gate2) is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
