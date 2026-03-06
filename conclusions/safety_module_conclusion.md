# Safety Module Conclusion

## Overview

The `agenticx/safety/` module provides a defense-in-depth security pipeline for AgenticX,
internalized from IronClaw (nearai/ironclaw) security architecture.

## Architecture

```
tool output
    │
    ▼
┌─────────────────────────────────────────┐
│           SafetyLayer (facade)          │
│                                         │
│  1. Length Truncation                   │
│  2. LeakDetector (secret redaction)     │
│  3. Policy (rule-based blocking)        │
│  4. Sanitizer (injection defense)       │
└─────────────────────────────────────────┘
    │
    ▼
sanitized output → LLM context
```

## Components

### LeakDetector (`agenticx/safety/leak_detector.py`)
- Dual-engine: optional Aho-Corasick prefix pre-filter + regex validation
- 17 built-in patterns: OpenAI, Anthropic, AWS, GitHub, Stripe, Slack, PEM keys, bearer tokens, etc.
- Actions: BLOCK (raise SecretLeakError), REDACT (replace with [REDACTED:name]), WARN (log)
- Extensible via `extra_patterns` parameter

### Sanitizer (`agenticx/safety/sanitizer.py`)
- 9 injection patterns: instruction override, role manipulation, system prompt injection, code injection
- Escapes dangerous LLM special tokens: `<|endoftext|>`, `[INST]`, `[/INST]`, etc.
- XML wrapping helpers: `wrap_for_llm()`, `wrap_external_content()` for LLM context isolation

### Policy (`agenticx/safety/policy.py`)
- Configurable rules with Block/Warn/Review/Sanitize actions
- Default rules: system file access (`/etc/passwd`), private keys, shell injection (`; rm -rf`)
- SQL injection warning, encoded exploit sanitization
- Extensible via `extra_rules` parameter

### SafetyLayer (`agenticx/safety/layer.py`)
- Unified facade: composes all components in fixed order
- Per-stage enable/disable via `SafetyConfig`
- Single integration point for ToolExecutor

## Integration

`ToolExecutor` accepts optional `safety_layer` parameter:

```python
from agenticx.safety.layer import SafetyLayer
from agenticx.tools.executor import ToolExecutor

safety = SafetyLayer()
executor = ToolExecutor(safety_layer=safety)
result = executor.execute(my_tool)  # output automatically sanitized
```

## LLM Resilience

### FailoverProvider (`agenticx/llms/failover.py`)
- Wraps primary + fallback providers
- Automatic failover on exception
- Configurable cooldown after repeated failures

### ResponseCache (`agenticx/llms/response_cache.py`)
- In-memory TTL cache with LRU eviction
- Keyed by SHA-256 prompt hash
- Hit/miss statistics tracking

## SelfRepair

### DefaultSelfRepair (`agenticx/core/self_repair.py`)
- Abstract interface for extensible recovery strategies
- Detects stuck tasks and broken tools via injectable callbacks
- Configurable max repair attempts with MANUAL_REQUIRED escalation

## Source Reference

Internalized from: https://github.com/nearai/ironclaw (MIT OR Apache-2.0)
Research notes: `research/codedeepresearch/ironclaw/`

## Known Technical Debt

1. `_escape_injection_phrases` in `layer.py` duplicates some patterns from `sanitizer.py`
   — tracked for consolidation in future refactor
2. `stream()` failover in `FailoverProvider` does not roll back partial output before failure
   — documented behavior, not a bug
3. `FailoverProvider` and `ResponseCache` are not thread-safe (no locking)
   — acceptable for current single-threaded agent use
