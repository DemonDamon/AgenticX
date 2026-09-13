#!/usr/bin/env python3
"""Tests for tool-call canonical identity.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from agenticx.reliability.call_identity import (
    canonical_call_key,
    canonical_payload,
    diff_canonical_fields,
    stable_call_id,
)


def test_key_stable_across_dict_order() -> None:
    assert canonical_call_key("t", {"a": 1, "b": 2}) == canonical_call_key(
        "t", {"b": 2, "a": 1}
    )


def test_key_differs_by_tool_name() -> None:
    args = {"a": 1}
    assert canonical_call_key("alpha", args) != canonical_call_key("beta", args)


def test_int_and_float_differ() -> None:
    assert canonical_call_key("t", {"n": 1}) != canonical_call_key("t", {"n": 1.0})


def test_negative_zero_normalized() -> None:
    assert canonical_call_key("t", {"n": -0.0}) == canonical_call_key("t", {"n": 0.0})


def test_nan_rejected() -> None:
    with pytest.raises(ValueError):
        canonical_payload({"n": float("nan")})


def test_inf_rejected() -> None:
    with pytest.raises(ValueError):
        canonical_payload({"n": float("inf")})


def test_unsupported_type_rejected() -> None:
    with pytest.raises(TypeError, match="object"):
        canonical_payload({"n": object()})


def test_bool_not_int() -> None:
    assert canonical_call_key("t", {"f": True}) != canonical_call_key("t", {"f": 1})


def test_nested_normalized() -> None:
    left = {"a": {"x": [1, {"z": 2}]}}
    right = {"a": {"x": [1, {"z": 2}]}}
    assert canonical_call_key("t", left) == canonical_call_key("t", right)


def test_tuple_equals_list() -> None:
    assert canonical_call_key("t", {"a": (1, 2)}) == canonical_call_key(
        "t", {"a": [1, 2]}
    )


def test_unicode_stable() -> None:
    payload = canonical_payload({"名": "值"})
    assert "名" in payload
    assert canonical_call_key("t", {"名": "值"}).startswith("t:")


def test_stable_call_id_fallback_deterministic() -> None:
    first = stable_call_id(
        "",
        tool_name="echo",
        iteration=2,
        position=1,
    )
    second = stable_call_id(
        None,
        tool_name="echo",
        iteration=2,
        position=1,
    )
    assert first == second == "synth-echo-2-1"
    assert (
        stable_call_id(
            "call_abc",
            tool_name="echo",
            iteration=2,
            position=1,
        )
        == "call_abc"
    )


def test_diff_fields_reports_changed_key() -> None:
    assert diff_canonical_fields({"a": 1, "b": 2}, {"a": 1, "b": 3}) == ("b",)
