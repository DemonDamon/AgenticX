# W1 Executable Subplan — Agent 写闸统一契约

> Parent: `docs/plans/2026-10-31-agx-agent-safe-query-capability-master.md`  
> Status: ready  
> Branch: `feat/agx-safe-query-w1-write-gate`

## Goal
Unify write-gate decision shape across NL2SQL and MCPHub so denials share stable `code`/`reason`; default remains deny for unsafe writes.

## Non-goals
No explain mode (W2). No UI (W4). No GraphStore changes (W3).

## Files
- Modify: `agenticx/managed/templates/data_suite/write_guards.py`
- Modify: `agenticx/managed/templates/data_suite/nl2sql.py`
- Modify: `agenticx/tools/mcp_hub.py`
- Test: `tests/managed/templates/test_nl2sql.py` (+ new MCP gate tests under `tests/tools/` or adjacent)

## Steps
- [ ] Inventory current denial strings (`write_guard_denied`, PermissionError paths)
- [ ] Add shared decision helper (extend `WriteGuardPolicy` or add `WriteGateDecision`) with fields: allowed, code, reason
- [ ] Route NL2SQL non-readonly denials through shared helper; keep backward-compatible code prefix
- [ ] MCPHub: tool snapshot/metadata `requires_write_enable`; default deny with `write_tools_disabled` when gated and not enabled
- [ ] Config/env or hub option to enable write tools explicitly (default off / current-safe)
- [ ] Pytest: deny paths + enable path with fake/minimal MCP
- [ ] Commit on feature branch; push (relay if Mac git broken); open PR titled for W1 only

## Done when
Pytest green for touched tests; default behavior still blocks unsafe writes; PR open.
