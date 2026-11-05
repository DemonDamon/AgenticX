# Admission reservation receipts

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

## Evidence

`enterprise/apps/gateway/internal/quota/check_request.go::CheckRequest` reserves daily tokens before weekly checks and monthly tokens before budgets, but later denial only releases concurrency. `billing/service.go::SettleContext` reselects current monthly rules/windows and ignores day/week. Server direct/channel/cache/protocol exits differ; channel completion omits budget receipt. Database pool updates and ledger insertion are separate operations.

## Implementation

1. Add `internal/quota/reservation_receipt.go`: pointer-owned receipt recording each successful day/week/month token precharge, original key/period/rule/amount, existing BudgetReceipt and captured concurrency release callback. Mutex protects first terminal outcome and per-line completion. Retry only incomplete operations against the first selected outcome.
2. `CheckRequest` creates/returns receipt and compensates on later rejection. RPM and request-count consumption remain admission-attempt counters and are never refunded. Warnings continue subsequent checks. Legacy non-receipt APIs remain.
3. `FinishReservation(receipt, actualTokens, actualCost)` adjusts original rows by actual-minus-reserved without current rule selection, with per-line completion and request-ID idempotence. Zero-output failure uses zero. `ReleaseReservation` releases only an acquired original key exactly once, including after config change.
4. Database pool Add: in one transaction ensure/lock original usage row, check request/event ledger deduplication, update usage and append ledger then commit. No schema migration. Configured database storage unavailable returns error, never local fallback.
5. Server `reportUsageDetailed` settles receipt with actual usage/cost; all admitted chat/protocol requests defer unfinished zero-usage compensation plus release. Private identity/context fields propagate receipt through routing changes. Receipt-aware branches bypass legacy monthly reconciliation. Billing helpers retain compatibility. Do not change embedding admission in this PR.

## Acceptance and boundaries

Add quota receipt tests for daily-success/weekly-reject, budget-later-reject, unchanged request counts, zero-output/partial usage, period rollover/config changes, duplicate concurrent terminals, storage-error retry and no fallback. Extend server coverage for direct/channel/cache/protocol propagation and preserve budget/partial-stream tests. Run quota/billing/server unit and race tests. Add opt-in real two-dialect storage tests and hosted disposable-database CI that requires these cases to execute. No grace periods, global DB admission gate, stream parser changes or shared renewable concurrency in this PR. No production/secrets; synthetic compilation/tests do not imply deployed acceptance.

## Concrete validation and recovery details

- `reservation_receipt_test.go` covers denial compensation, original rows across midnight/month/rule changes, first-outcome concurrent idempotence, retry of only a failed later counter, acquired-slot ownership, and configured database failures without local fallback. Admission-attempt RPM/request counts remain charged after a later denial; token windows and budgets are compensatable reservations.
- `ledger.go::PGPoolCounter.mutate` locks the usage row before deduplication and atomically persists counter plus ledger. Terminal deduplication uses its receipt/line ID across settlement and refund outcomes. A failed admission with an ambiguous commit acknowledgement can compensate only an original reserve ledger row actually found under the same row lock, so it cannot subtract another request's usage.
- `reservation_integration_test.go::TestReservationAllChatExitsSettleOriginalRows` exercises seventeen direct/channel/cache/protocol success, pre-output failure, unavailable route, zero-output stream and partial-stream exits. It checks original day/week/month rows, budget rows and concurrency release. Authoritative nonzero provider totals remain intact.
- `.github/workflows/gateway-reservation-storage.yml` has disposable two-dialect services and runs `TestReservationRealDatabase` plus existing `TestBudgetDatabaseURLReceiptLifecycle` with explicit fixture URLs. JSON event checks require both cases to pass and reject skips. The new fixture refuses any database other than `agx_quota_test`; it validates durable retry deduplication and transaction rollback if ledger insertion fails.
- Locally, affected quota/billing/server race suites pass (68 + 1 + 143 test/subtest events); two real-database cases explicitly skip because no dedicated local databases are configured. Hosted real-store results remain pending publication.
- Full gateway tests pass all other packages but the existing `mcphost::TestConnectorBackendExecuteActionMissingConnection` fails in this worktree and the untouched base worktree with the same assertion. No unrelated tool-host changes are included. Affected-package vet and workflow syntax checks pass.

- Stream-progress integration: `server/stream_accounting.go` captures provider usage before response transforms and retains only a character count for fallback text, reasoning and tool deltas. Both direct and multi-protocol stream completion/error exits prefer cumulative provider usage, including usage-only frames; no-usage tool-only interruptions use a prefix estimate. Four additional end-to-end synthetic cases verify usage-only/tool-only errors in both paths. First terminal usage is retained during deferred compensation. The real-storage step uses pipefail and rejects skipped descendants as well as skipped top-level cases.

Final review also guards all-zero streaming usage placeholders: they cannot replace an already observed text, reasoning or tool prefix with a zero-token refund. Positive reported usage remains authoritative, and genuinely empty cancellation still refunds. The new stream-accounting cases and quota/billing/server race suites pass.

Hosted persistence validation exposed a real duplicate-row lock conversion deadlock in the second database dialect. The counter initialization now uses a no-op duplicate-key update to acquire an exclusive row lock before the existing locking read; ledger/idempotency behavior and the eight parallel retry assertions remain unchanged. See the database locking reference: https://dev.mysql.com/doc/refman/8.0/en/innodb-locks-set.html . An isolated loopback 8.0.36 fixture passed both real reservation and budget contracts three consecutive times with race detection, and was removed afterward. The hosted dual-dialect matrix must still finish at the new head.
