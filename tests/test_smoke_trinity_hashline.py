#!/usr/bin/env python3
"""Smoke tests for trinity hashline utilities.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.tools.hashline import compute_line_hash
from agenticx.tools.hashline import format_hashline
from agenticx.tools.hashline import inject_hashlines
from agenticx.tools.hashline import validate_line_ref


def test_hashline_happy_path() -> None:
    content = "alpha\nbeta"
    injected = inject_hashlines(content)
    rows = injected.splitlines()
    assert rows[0].startswith("1#")
    assert rows[1].startswith("2#")
    line_ref = rows[1].split("|", 1)[0]
    assert validate_line_ref(["alpha", "beta"], line_ref) is None


def test_hashline_mismatch_and_bounds() -> None:
    tag = compute_line_hash(1, "alpha")
    mismatch = validate_line_ref(["changed"], f"1#{tag}")
    assert mismatch is not None
    assert "Hash mismatch" in mismatch
    out_of_bounds = validate_line_ref(["alpha"], "2#AA")
    assert out_of_bounds is not None
    assert "out of bounds" in out_of_bounds


def test_format_hashline_stable_shape() -> None:
    rendered = format_hashline(11, "value")
    assert rendered.startswith("11#")
    assert rendered.endswith("|value")
