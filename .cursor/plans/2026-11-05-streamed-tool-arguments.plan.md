# streamed-tool-arguments

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

Baseline: a680b0663fe4f1ecf1afe5c4ac52b124df57a5b6.

## Evidence and changes
`agenticx/runtime/agent_runtime.py::_repair_streamed_tool_arguments` returns `{}` for malformed JSON, null and arrays. The streamed aggregation dispatch guard only rejects empty objects for tools in a static required-argument table, so malformed custom optional-argument calls can execute.
FR1: Return Optional[Dict] from the parser: preserve valid `{}` and supported object extraction, return None for empty/malformed/non-object input. At the streamed aggregation call site (~5374), reject None before `_streamed_tool_call_truncated` and dispatch; use the existing model retry hint path.
AC: Extend `tests/test_smoke_streaming_tool_truncation.py` and runtime integration tests: truncated JSON/null/arrays cannot dispatch a synthetic optional-parameter tool; valid `{}` dispatches once; known object-repair cases still work. Run pytest on both targeted suites.
Out of scope: full JSON Schema validation, stream replay/loop changes, tool registration.

## Validation
Targeted new parser and optional-tool dispatch contracts: 14 passed. Full `tests/test_smoke_streaming_tool_truncation.py tests/test_agent_runtime.py`: 64 passed, 2 failed. Both failures reproduce against the unmodified runtime baseline: `test_skip_user_history_still_persists_display_user` expects two persistence calls but receives four; `test_create_avatar_malformed_final_uses_public_message` retains malformed reasoning. No unrelated runtime behavior was changed to conceal these failures. `git diff --check`: clean.

## Remote regression acceptance
The shared path-filtered Python 3.12 contribution workflow uses this branch's locked product dependencies and compatible fixed test tools. It prints the available regression files, selects only `test_optional_tool_dispatch_requires_valid_streamed_object` from the broad runtime test file, and requires every selected case to execute without skips. Missing document/crypto dependencies fail before optional parser tests can skip. Both workflow structure and the empty/skipped JUnit guard were validated locally; the current branch's focused selection is run before publishing. The security scan also triggers for contribution bases beyond main/master, without adding repeated feature-branch push runs.

Local CI runner on this branch: 45 cases passed, zero skips, with the fixed compatible test tools. Only the five optional-tool dispatch parameterizations from the broad runtime file were selected; neither unrelated known baseline failure was disabled or changed.
