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
