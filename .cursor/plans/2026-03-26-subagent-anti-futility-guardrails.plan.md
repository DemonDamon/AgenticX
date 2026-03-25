---
name: Subagent Anti-Futility Guardrails
overview: "Reduce subagent wall-clock waste from meta confirmation files and file_write loops via LoopDetector saturation, progress heuristics, system prompt rules, checkpoint stall injection, and confirmation-spam termination."
todos:
  - id: loop-detector-saturation
    content: Add _detect_tool_saturation to LoopDetector
    status: completed
  - id: progress-tracking-refine
    content: Penalize repeated file_write paths in has_progress for loop detection
    status: completed
  - id: system-prompt-guardrails
    content: Anti-pattern rules in _build_subagent_system_prompt
    status: completed
  - id: checkpoint-injection
    content: Inject stall warning into messages at subagent checkpoint when file-write heavy
    status: completed
  - id: confirmation-spam-detector
    content: Terminate non-meta subagent after repeated spam-pattern filenames
    status: completed
  - id: tests
    content: Tests for tool_saturation and confirmation spam score helper
    status: completed
isProject: true
---

# Subagent Anti-Futility Guardrails

## Problem

Subagents could burn the default 600s timeout creating many `TODO_*` / `*_FINAL*` markdown files instead of executing the delegated task. Loop detection missed this because each write had a different path/signature and successful writes were treated as progress.

## Implementation (landed)

| Area | Location |
|------|----------|
| `tool_saturation` detector | `agenticx/runtime/loop_detector.py` — `_detect_tool_saturation` in `check()` chain |
| Write-path frequency + spam stop | `agenticx/runtime/agent_runtime.py` — `write_path_counts`, `_confirmation_spam_score_for_path`, checkpoint stall `messages.append` |
| Subagent prompt | `agenticx/runtime/team_manager.py` — section 反模式规则（关键） |
| Tests | `tests/test_loop_detector.py` |

## Requirements

- **FR-1**: Same tool dominating recent window with insufficient `has_progress` triggers saturation detection.
- **FR-2**: Third+ write to the same path in a turn does not count as file_write progress for loop marks.
- **FR-3**: Subagents are instructed not to create completion-confirmation file spam unless the task asks for docs.
- **FR-4**: On every 8th round checkpoint, if recent tool stream is file-write-heavy and low variety, inject a corrective user message (English) with task excerpt.
- **FR-5**: Non-`meta` agents: three writes whose basenames match two+ spam keywords terminate with `confirmation_spam`.
- **AC-1**: `pytest tests/test_loop_detector.py` passes.

## Conclusion

Guardrails are additive; happy-path coding subagents unchanged unless they hit spam patterns or saturation thresholds.
