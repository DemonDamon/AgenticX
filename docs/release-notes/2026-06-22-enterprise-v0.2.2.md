# AgenticX Enterprise v0.2.2

Release tag: `enterprise-v0.2.2`  
Published: 2026-06-22

## Installation / Upgrade

```bash
cd enterprise
git pull
bash scripts/bootstrap.sh    # first run or after env/secret changes
bash scripts/start-dev.sh    # or start-dev-with-infra.sh when infra is required
```

After upgrading, restart `admin-console` and `web-portal` so the sidebar brand subtitle picks up `v0.2.2` from `enterprise/package.json`.

## Highlights

- **Enterprise Gateway**
  - Added dynamic pricing with base token rates plus complexity surcharges.
  - Introduced budget warning and soft circuit-breaker flow for cost control.
  - Extended governance with field-level RBAC, session-scoped temporary grants, and near-real-time PAT revocation.
  - Added data-residency and cross-border compliance auditing capabilities.
  - Added shared token-pool quota accounting with PostgreSQL ledger support.
  - Expanded provider/routing stack: Azure + Bedrock adaptors, MCP upstream proxy, latency-aware routing, and prefix-cache affinity balancing.
  - Enabled multimodal passthrough in gateway request flow.

- **Enterprise Admin Console**
  - Upstream provider model fetching now includes merged Zhipu VLM catalog support.
  - Added token-consumption heatmap and ROI analytics views.
  - Added quota remaining visibility and package SKU/snapshot lifecycle support.
  - Delivered department visible-model controls (batch assignment + ancestor inheritance + v2 cascading sheet UI).
  - Added enterprise version in sidebar brand area (`管理后台 · v0.2.2`).

- **Enterprise Web Portal**
  - Added image attachment send pipeline for chat.
  - Added queue-while-streaming behavior to protect in-flight responses.
  - Added Kimi-style generating indicator and scroll-to-bottom FAB improvements.
  - Added enterprise version in sidebar brand area (`Workspace · v0.2.2`).

- **IAM / Department Experience**
  - Department details now show direct members only (no unintended subtree merge).
  - Department panel UX was refined into a more WeCom-like structure for members/sub-departments and action placement.

## Fixes & Improvements

- **Gateway / Runtime Reliability**
  - Fixed gateway proxy conflict and admin dashboard fetch race conditions.
  - Improved MOMA provider health-check fallback and configuration validation.
  - Updated smoke scripts to avoid hard dependency on `rg`.

- **Portal / Admin UX Stability**
  - Fixed image attachment persistence in chat history.
  - Preserved partial content on stream interruption.
  - Isolated stream state per session to prevent cross-session leakage.
  - Fixed generating-dots animation regressions and refined FAB placement.
  - Prevented text selection from incorrectly triggering message multi-select.
  - Restored soft-deleted user on same-email recreation.

- **Ops / Troubleshooting**
  - Corrected Docker compose `--progress` flag placement.
  - Persisted `db:migrate` logs to runtime logs and surfaced real migration exit codes in startup scripts.

## Stats

- **Commit range**: `c17b6e3d..7f55a4f1`
- **Commits**: 362
- **Time span**: 2026-05-25 → 2026-06-22

## Links

- Release page: https://github.com/DemonDamon/AgenticX/releases/tag/enterprise-v0.2.2
- Compare: https://github.com/DemonDamon/AgenticX/compare/enterprise-v0.2.1...enterprise-v0.2.2
