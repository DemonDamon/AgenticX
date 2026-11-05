# Shared renewable concurrency leases

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

## Evidence and exact scope

`enterprise/apps/gateway/internal/quota/limiter.go::RateLimiter` shares RPM/TPM through its backend but concurrency remains a per-process map. `check_request.go::CheckRequest` already captures a release callback in the admission receipt. Use that lifetime interface rather than duplicating release paths. No deployment, live secrets, entitlement changes or global database semaphore.

## Implementation

- Add `quota/concurrency_lease.go`: independent ConcurrencyLease interface (Release, Bind, IsLost, Lost), owner-identified local and shared store contracts. A lease tracks a last-confirmed deadline using call-start time plus TTL minus safety margin (45s TTL/1s margin, 10s initial renewal/1s retry). Successful responses may extend only an unexpired lease. Compare monotonic and wall time; a late response cannot revive loss.
- Independent watchdog checks the confirmed deadline separately from renewal I/O. Transient errors retry only while confirmed-valid; explicit missing owner loses immediately. IsLost synchronously verifies the deadline before handlers return success. Bind propagates ErrConcurrencyLeaseLost to request context; release cancels workers and removes only its own owner.
- Add `quota/concurrency_redis.go`: server TIME, sorted-set expiry cleanup, idempotent owner acquire, owner-checked renew/release via atomic scripts and key TTL. Use bounded socket timeouts on a dedicated client view. Configured-but-unreachable shared storage fails closed for concurrency; RPM/TPM keep their existing fallback. Empty shared configuration logs one clear single-process warning.
- `RateLimiter.AcquireConcurrencyLease` uses the configured store, and `Tracker` optionally accepts an independent limiter for deterministic multi-instance tests. `CheckRequest` captures lease plus release in ReservationReceipt; storage errors refuse admission. Server `runChatQuotaGate` supplies r.Context; after admission both chat/protocol bind lease cancellation to r and defer cleanup. Every output callback and final success checks IsLost; upstream completion that swallows cancellation cannot become success.

## Acceptance

Unit/race: independent limiter instances, owner isolation, temporary renew error recovery, persistent failure deadline, explicit missing owner, stalled renewal not delaying watchdog, synchronous expiry without scheduling, late success cannot revive, release stopping retry. Actual Redis service tests are opt-in locally and required in a hosted workflow with JSON pass/no-skip checks. Two independent OS processes each run an HTTP Gateway with distinct limiter clients and share the service: limit3 and 12 synchronized requests yield exactly3 HTTP200/9 HTTP429; owner crash expires, short pause recovers, long pause cancels before confirmed expiry. Use synthetic identities, no real configuration.

## Final integration and validation evidence

- Production defaults remain TTL45s / margin1s / renew10s / retry1s with bounded operation sockets. `NewSharedRateLimiterWithLeaseOptions` validates explicit embedding timings; the subprocess fixture passes TTL2s/margin200ms/renew300ms/retry50ms/op50ms without changing deployment environment behavior.
- The shared client is constructed even during initial storage unreachability, so admission fails closed and recovers when the service returns. Only malformed shared configuration retains a permanent configuration error. `NewTracker` initializes the selected limiter at startup so empty configuration emits its single-process warning; the independent-limiter constructor avoids global-singleton reuse in fixtures.
- Cache hits check both request cancellation and synchronous lease validity after lookup and before each write. Success metering occurs only after output was written. An interrupted cached replay stops before later chunks/DONE and settles only its already delivered prefix; expired/cancelled hits are not billed as successful cache responses. Added protocol-cache, request-context and mid-replay regression cases.
- Both direct and protocol SSE interrupted-loss paths emit safe50302, as do synchronous final checks; providers swallowing cancellation cannot emit a successful terminal. The protocol mid-stream contract explicitly exercises the typed loss code.
- Actual isolated service validation with race passed: low-level250ms command-processing pause recovers;1500ms pause loses confirmed validity; stopped owner TTL reclaims and old owner cannot renew/release successor. These are command-processing pauses, not disconnected TCP sessions.
- Two real test-binary child processes each run the real HTTP Router, independent limiter/client and synthetic signed identity. Twelve truly overlapping held streams produce exactly3 HTTP200 and9 quota429. No process-local singleton is shared across those child processes.
- Actual HTTP subprocess long-stream cases passed:500ms pause survives more than one TTL and emits DONE;3000ms pause emits50302 and cancels the real synthetic upstream HTTP request before the configured conservative deadline; killing a process holding all3 slots leaves a surviving gateway at429 before TTL, then200 after expiry. No graceful cleanup was used to release the killed owner's slots.
- Separately, a real loopback socket accepting commands without responding cannot stall the watchdog; synthetic temporary/persistent errors, explicit missing owner, late renewal success, synchronous deadline, released-lease rebind and invalid timings are unit-tested under race. Actual host sleep/resume was not performed; the implementation checks both monotonic and wall deadlines.
- `.github/workflows/gateway-shared-concurrency.yml` runs the three real-service cases sequentially across packages (`-p1`) so pause fault injection cannot contaminate the admission harness. JSON gates require all target cases and descendants to pass without skips. Local disposable storage container is removed after validation. No deployed services or secrets were used.
