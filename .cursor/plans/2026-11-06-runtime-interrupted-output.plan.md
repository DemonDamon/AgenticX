# runtime-interrupted-output

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

Baseline: ab2db01a7cb8810382aea1126aa1026928c7196b, including the independent malformed-argument fix.

## Evidence and scope
`agenticx/runtime/agent_runtime.py::_run_turn_inner` (~5146–5463) receives content/tool deltas from `stream_with_tools`, but its general exception handler unconditionally sets `used_stream_path = False`. The following synchronous invoke can therefore repeat a request after externally visible output. `agenticx/runtime/loop_controller.py::run_loop` (~51–64) forwards ERROR events and starts another iteration, creating a second replay layer. The current provider stream contract encodes reasoning in content using `<think>` tags; reasoning-only content must count as output even when no visible body is ready.

In scope: this model-call streaming fallback, safe prefix history, the outer loop terminal decision, deterministic regression tests and their existing CI selector. Out of scope: transport protocol redesign, crash-recovery/replay-ledger policy, provider retry budgets, tool registration, dependency upgrades, Studio/server implementation, deployments and unrelated broad-runtime failures.

## Functional requirements and implementation
FR1 — In `_run_turn_inner`, initialize a per-model-call `stream_had_output` flag beside `used_stream_path`. Set it before emitting any nonempty content (including encoded reasoning), or a tool-call delta carrying an id, name or argument fragment. Usage/done/empty chunks do not count. Before output, leave the existing invoke fallback unchanged. On a stream exception after output, log the fault as nonretryable, preserve the safe body, persist the existing terminal checkpoint, emit exactly one ERROR with `detector: stream_interrupted`, `partial: true`, `retryable: false`, and safe fixed text, then return before invoke or tool aggregation/dispatch. Never expose exception text or incomplete tool calls in history/events.

FR2 — Reuse `AgentRuntime._finalize_cancelled_prefix` (~3893). Add an explicit keyword identifying network interruption so its existing visible-body parser, plain model-history row and interrupted-partial display metadata are reused. Preserve the cancellation compatibility flag for existing callers; that cancellation-only flag cannot disable safe network-interrupted history. Reasoning/control markup without visible body saves no assistant row. Keep `turn_terminal: false` for the preserved partial row, consistent with explicit user continuation. Use `_persist_final_checkpoint()` after preserving partial state; no new storage/replay mechanism.

FR3 — In `LoopController.run_loop`, after forwarding a `stream_interrupted` ERROR return immediately and explicitly close the current turn generator in `finally`. Preserve ordinary errors and completion/max-iteration behavior. The signal is explicit, not guessed from error prose.

The public `AgentRuntime.run_turn` wrapper (~4158) also recognizes this detector when finishing the existing run recorder, so its status is `interrupted` rather than a generic `failed`. Like an emitted FINAL, this handled terminal error clears its existing checkpoint even if the consumer closes at the error instead of exhausting the generator. Otherwise the loop's early return could leave a resumable checkpoint and implicitly replay after restart. Contracts verify both recorder status and checkpoint clearing for normal exhaustion, direct close at ERROR, loop completion and loop close at ERROR, without introducing a new recovery mechanism.

## Acceptance contracts
Add `tests/test_runtime_interrupted_stream.py` with a real runtime and synthetic stream/invoke counters, optional tool dispatcher and controlled watchdog errors:
- Nonempty text then disconnect: stream=1, invoke=0; TOKEN retained; ERROR is fixed safe text with the terminal detector; no FINAL; plain partial in both histories and in the last persistence snapshot; no exception secret marker.
- Reasoning-only and reasoning-plus-body then disconnect: invoke=0; reasoning never enters plain history, while any visible body survives.
- Tool-name/id/arguments-only deltas then disconnect, including a complete-looking argument object: invoke=0, dispatch=0 and no assistant `tool_calls` row.
- Empty/usage/done chunks followed by a pre-output error: invoke=1 and normal FINAL.
- Explicit next user turn receives the prior partial as context; cancellation compatibility flag OFF still cannot erase network-interrupted partials.
- Watchdog idle failure after content has identical no-replay behavior.
Extend `tests/test_loop_controller.py`: synthetic interrupted ERROR stops after one `run_turn`; ordinary ERROR still uses the existing iteration budget; integration with the real partial-stream runtime calls the model only once.

Update `scripts/ci/python-regressions.py::TEST_FILES` to include both new/changed suites, existing cancelled-prefix and watchdog tests, interrupted-tool-closer tests and branch-safe context checkpoint tests. The existing JUnit guard must enforce nonempty/no-skip execution. Run the bounded runner with its pinned pytest/asyncio tools. Separately run existing HA checkpoint/resume and session execution-state suites; report any missing optional dependency instead of claiming skipped coverage. Run the full broad runtime file once and explicitly report its two known baseline failures without changing, weakening or hiding assertions: persistence call count and malformed final reasoning.

## Validation record
- The existing Python CI runner, using its fixed pytest 8.4.2 / pytest-asyncio 0.26.0 tools: **107 passed, zero skips**. Selection includes 25 interrupted-stream cases and four loop-controller cases, plus cancellation prefix, stream watchdog, interrupted-tool closers, branch-safe context checkpoints and the first-batch tool-argument/provider/usage contracts available on this branch. Files from other independent dependency/status contributions are reported as absent rather than silently invented.
- Existing HA checkpoint/resume and Studio session execution-state regressions: **15 passed, zero skips** after installing the declared-range test-only fake-storage dependency in the temporary test environment. No manifest or lock changes.
- Existing follow-up cleanup plus cancellation/closer/context-checkpoint group: **27 passed**.
- Full `tests/test_agent_runtime.py`: **42 passed, two known baseline failures**. `test_skip_user_history_still_persists_display_user` receives persistence counts `[1, 1, 1, 2]` instead of `[1, 2]`; `test_create_avatar_malformed_final_uses_public_message` retains malformed reasoning text. These same failures were verified on the unmodified earlier baseline. Neither assertion nor product behavior was changed to hide them, and no blanket test deselection/xfail was added.
- `git diff --check`: clean. The Studio server, dependencies and crash-recovery ledger implementation are unchanged.
