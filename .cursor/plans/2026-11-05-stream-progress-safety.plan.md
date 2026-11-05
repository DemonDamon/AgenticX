# Stream progress, bounded reads and retry safety

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

## Evidence and scope

At baseline e211a9e0, provider and adaptor SSE parsers wait for an entire newline before considering the upstream active. A slow, continuously arriving frame can therefore time out. Provider EOF succeeds without a terminal frame. The relay only remembers text/reasoning within one key attempt and forgets this fact before channel failover. Its pivot types also omit streamed tool-call and usage fields.

In scope: shared bounded byte-active SSE reads, separate response-header timeout and caller-owned total deadline, common compatible-stream termination, preservation of tool/usage fields, and retry exclusion after any callback attempt. Out of scope: new provider selection policy, billing rules, quota lifecycle, alternate protocol rewrites, or application deployment.

## Implementation points

1. `enterprise/apps/gateway/internal/streamio/sse.go`: add Config (existing IdleTimeout/ScannerMaxBufferB plus HeaderTimeout), Event and ReadSSE. One bounded read pump per stream delivers fixed-size byte batches. Any positive-byte read resets idle; zero-byte reads do not. Cap line/event and cumulative event data before retaining oversized input. Context cancellation, timeout or callback completion cancels the pump and closes closable bodies. EOF flushes the pending event but does not by itself imply protocol completion.
2. `internal/streamio/http.go`: DoStream clones the client with Timeout=0, derives the request context and applies a response-header timer only until Do returns. Body closure cancels that context. The caller context continues to enforce total deadline; header timeout and body idle have distinct stable errors. Default header budget follows existing idle headroom, with an explicit environment override.
3. `internal/openai/sse.go`: decode common event envelopes through ReadSSE; track DONE or nonempty finish_reason. EOF without either returns stream:incomplete. Preserve existing heartbeat tolerance/error envelopes. Emit usage-only chunks as well as choices/id/object chunks.
4. `internal/openai/types.go`: preserve Delta.ToolCalls as raw JSON and StreamChunk.Usage as an optional Usage pointer. No tool execution or billing policy is added here.
5. `internal/provider/openai_http.go` and `internal/adaptor/openai.go`: replace duplicated SSE loops with the common decoder. HTTP call sites use DoStream and pass their actual request context to parsing. Keep compatibility wrapper signatures for existing tests. Use the same header helper on the compatible cloud endpoint adapter without changing its request conversion.
6. `internal/relay/executor.go`: set progress before invoking push, regardless of chunk contents or push result. Carry it out of streamOnChannel; neither another key nor another channel may execute afterward. Before first callback, preserve existing retry classifications and failover.
7. `.github/workflows/gateway-regressions.yml`: run affected provider/adaptor/relay/openai/streamio packages with race detection and vet alongside existing config/server coverage. Pull requests against dependency branches remain covered.

## Executable acceptance

- `internal/streamio/sse_test.go`: fragmented bytes take longer than idle to complete a line but succeed; genuine idle fails; zero-byte reads do not renew activity; no-newline/multiline limits refuse before unbounded allocation; cancellation closes a stalled body; total deadline wins over heartbeat traffic; EOF flush and CRLF work.
- `internal/streamio/http_test.go`: delayed headers fail with header_timeout; prompt headers plus delayed body are governed by body idle; canceling after headers terminates the body.
- `internal/openai/sse_test.go`: DONE/finish_reason terminate successfully; nonterminal EOF fails; tool arguments survive raw JSON; usage-only frames reach push; callback failures propagate.
- Extend provider/adaptor real local HTTP tests for missing-terminal EOF and slow fragmented wire bytes.
- `internal/relay/stream_progress_test.go`: fake adapter plus deterministic two-channel selection verifies text, reasoning, tool-only, usage-only, role-only and push-error paths invoke only one upstream attempt; first-callback failure remains eligible for failover. Existing multiprotocol integration tests remain passing.
- Run `go test -count=1 ./internal/streamio ./internal/openai ./internal/provider ./internal/adaptor ./internal/relay`, the same packages with `-race`, and the complete gateway suite. Do not claim remote execution until its run has completed.

## Delivery

Keep this PR on the trusted-proxy dependency branch; do not merge main. Commit the implementation, relevant tests/workflow and this plan with the previously confirmed model metadata. Public commit/PR prose describes product behavior without customer identifiers or external comparison language.

## Local validation

- Shared read/HTTP, compatible decoder, provider, adapter and relay packages pass ordinary and race suites; vet passes. Local HTTP tests cover cancellation, premature EOF and fragmented tool/usage frames.
- Independent review reproduced and then guarded two further boundaries: synchronous downstream backpressure does not consume upstream idle budget, and padded data lines count their original wire bytes before retained trimming. Zero-byte reads still expire.
- The complete gateway suite passes all packages except the pre-existing missing-connection assertion in internal/mcphost; the same assertion was reproduced in the unchanged dependency worktree. Its expectation is not changed by this PR.
- Workflow syntax passed actionlint. Hosted execution is pending publication and must be reported separately.
