"""Regression: CC↔CB orchestration SSE must bind normalize_tool_sse_payload locally.

Post #322, `_drain_cc_orchestration_sse_lines` used `normalize_tool_sse_payload`
while a later local import in the enclosing `_external_harness_chat_stream`
made that name a free variable. Calling the drain before that import ran
raised:

  cannot access free variable 'normalize_tool_sse_payload' where it is not
  associated with a value in enclosing scope

`_midturn_item_to_sse` already imports locally; the drain must match.
"""

from __future__ import annotations

import ast
from pathlib import Path


def _drain_fn_node(tree: ast.AST) -> ast.AsyncFunctionDef:
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.AsyncFunctionDef)
            and node.name == "_drain_cc_orchestration_sse_lines"
        ):
            return node
    raise AssertionError("_drain_cc_orchestration_sse_lines not found in server.py")


def test_drain_cc_orchestration_imports_normalize_locally() -> None:
    src = Path("agenticx/studio/server.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    drain = _drain_fn_node(tree)
    local_imports = [
        n
        for n in ast.walk(drain)
        if isinstance(n, ast.ImportFrom)
        and n.module == "agenticx.runtime.events"
        and any(a.name == "normalize_tool_sse_payload" for a in n.names)
    ]
    assert local_imports, (
        "_drain_cc_orchestration_sse_lines must locally import "
        "normalize_tool_sse_payload (same pattern as _midturn_item_to_sse)"
    )


def test_free_var_repro_needs_local_import() -> None:
    """Minimal Python semantics repro of the #322 UnboundLocalError."""

    calls: list[str] = []

    def outer() -> None:
        def nested() -> None:
            # Intentionally no local import — mirrors the pre-fix drain.
            calls.append(normalize_tool_sse_payload({"name": "x"}))  # noqa: F821

        nested()
        from agenticx.runtime.events import normalize_tool_sse_payload  # noqa: F401

        _ = normalize_tool_sse_payload

    try:
        outer()
        raised = False
    except Exception as exc:  # noqa: BLE001 — assert exact failure mode
        raised = True
        msg = str(exc)
        assert "normalize_tool_sse_payload" in msg
        assert "enclosing scope" in msg or isinstance(exc, UnboundLocalError)

    assert raised, "expected free-variable failure without local import"
    assert calls == []

    # With local import (the fix pattern), nested succeeds even if outer
    # also imports the same name later.
    calls.clear()

    def outer_fixed() -> None:
        def nested() -> None:
            from agenticx.runtime.events import normalize_tool_sse_payload

            payload = normalize_tool_sse_payload(
                {"name": "spawn_subagent", "tool_call_id": "t1", "arguments": {}}
            )
            calls.append(str(payload.get("name") or ""))

        nested()
        from agenticx.runtime.events import normalize_tool_sse_payload  # noqa: F401

        _ = normalize_tool_sse_payload

    outer_fixed()
    assert calls == ["spawn_subagent"]
