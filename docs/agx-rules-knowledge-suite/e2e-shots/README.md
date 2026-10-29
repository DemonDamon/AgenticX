# Rule governance admin e2e shots (P0)

HD screenshots (1920×1080 @2x) of admin-console **规则治理 / rule-governance**.

## How to open admin

1. Start enterprise stack (if not already running):

   ```bash
   bash enterprise/scripts/start-dev.sh --ui=stream
   ```

2. Open **http://127.0.0.1:3001/login** → sign in with `ADMIN_CONSOLE_LOGIN_*` from `enterprise/.env.local`.
3. Navigate to **http://127.0.0.1:3001/admin/rule-governance**.

## Re-run e2e

```bash
set -a && source enterprise/.env.local && set +a
# optional: seed Brand-A rules under enterprise/.runtime/admin/rules/
pnpm -C enterprise exec tsx scripts/e2e-rule-governance.ts
```

## Shots

| File | What |
|------|------|
| `01-rule-governance-list.png` | List + detail layout after load |
| `02-rule-governance-detail.png` | Detail panel focused (Brand-A sample) |
| `03-rule-governance-executions.png` | Recent executions when seeded |

Synthetic **Brand-A** ids only — no real customer names.

# Knowledge lifecycle admin e2e shots (P1 K2)

HD screenshots of admin-console **知识生命周期 / knowledge-lifecycle** under the data-governance domain.

## Re-run e2e

```bash
set -a && source enterprise/.env.local && set +a
pnpm -C enterprise exec tsx scripts/e2e-knowledge-lifecycle.ts
```

## Shots

| File | What |
|------|------|
| `04-knowledge-lifecycle-list.png` | Object list + detail after load |
| `05-knowledge-lifecycle-detail.png` | Detail / transitions focused |
| `06-knowledge-lifecycle-issues.png` | Quality issues panel after run |

Synthetic **Brand-A** ids only — no real customer names.

# Disambiguation choice-panel admin e2e shots (P1 R2)

HD screenshots of admin-console **消歧确认 / disambiguation** choice panel.

## Re-run e2e

```bash
set -a && source enterprise/.env.local && set +a
pnpm -C enterprise exec tsx scripts/e2e-disambiguation.ts
```

## Shots

| File | What |
|------|------|
| `07-disambiguation-candidate-select.png` | Candidate select mode |
| `08-disambiguation-info-supplement.png` | Info supplement mode |
| `09-disambiguation-conflict-resolve.png` | Conflict resolve mode |

Synthetic **Brand-A** ids only — no real customer names.

