# AGX Rules (P0)

First-class rule assets: entity model, DSL, NL draft stub, Flow compile, execution records.

## Quick lifecycle demo

```bash
# from repo root
python -m examples.rules.run_lifecycle
# optional: custom store dir
python -m examples.rules.run_lifecycle /tmp/agx-rules-demo
```

Expected: exits 0 and prints rule id, compiled node types, and execution status.

## Pytest gate

```bash
pytest tests/rules/ -q -o addopts=
```

## Admin console (minimal)

Section **Rule governance** at `/admin/rule-governance` lists rules and shows detail
(status, body summary, recent executions) from the same JSON store
(`AGX_RULES_STORE_DIR` or `.runtime/rules` / admin default under
`.runtime/admin/rules`).

UI pages beyond list/detail are deferred; data model + API are ready.

## Admin UI e2e (HD screenshots)

With enterprise admin-console on `:3001`:

```bash
set -a && source enterprise/.env.local && set +a
pnpm -C enterprise exec tsx scripts/e2e-rule-governance.ts
```

Shots + how-to-open notes: `docs/agx-rules-knowledge-suite/e2e-shots/`.
Admin URL: http://127.0.0.1:3001/admin/rule-governance

## Desensitize checklist

- No real customer / company / proposal names in `agenticx/rules/`, `examples/rules/`, or fixtures.
- Sample YAML uses Brand-A / Market-X style synthetic labels only.
- External engine backend remains a stub — customer adapters stay in B-layer.
