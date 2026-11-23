---
name: enterprise-trace-runtime-guard
overview: Sub-plan A. In the Python runtime, strip content excerpts unless the tenant policy allows them, and bind each outbox line to the signed-in enterprise account so spans never cross accounts.
todos:
  - id: a1-policy-read
    content: Add trace_content_allowed() and _redact_content() and apply redaction in enqueue_completed_run
    status: completed
  - id: a2-account-tag
    content: Add _current_account_key(), stamp _acct in _append_outbox, filter and strip in flush_outbox/_post_spans
    status: completed
  - id: a3-tests
    content: Update and extend tests/test_enterprise_trace.py; run pytest
    status: completed
isProject: false
---

# Sub-plan A: runtime content redaction and outbox account binding

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7 xhigh
Master: `.cursor/plans/2026-11-15-enterprise-trace-account-closure.plan.md` (read section 3 "Shared contract" first)

## Files (only these two)

- `agenticx/runtime/enterprise_trace.py`
- `tests/test_enterprise_trace.py`

Python rules: English-only comments/docstrings, keep `Author: Damon Li` in the module docstring, absolute imports, imports at file top (`import hashlib` goes with the existing stdlib imports).

## Root cause

1. `build_spans` writes `metadata.user_text` (run span, via `_user_text`), `metadata.reply` and `metadata.thought` (model span, via `_reply_text` / `_thought_text`). `enqueue_completed_run` appends them to the outbox unconditionally.
2. `_append_outbox` writes bare span JSON. `flush_outbox` -> `_post_spans` -> `_enterprise_endpoint()` uses the token present at flush time, so lines queued by a previous account are posted under the current account.

## Changes

### A1. Policy read and redaction

Add near the other module constants:

```python
_CONTENT_KEYS = ("user_text", "reply", "thought")
_ACCOUNT_FIELD = "_acct"
```

Add after `trace_upload_enabled()`:

```python
def trace_content_allowed() -> bool:
    """True only when the tenant policy explicitly allows content excerpts.

    Reads ``enterprise.agent_action_policy.trace_content`` (desktop writes
    snake_case; ``traceContent`` is accepted too). Anything else is False.
    """
    try:
        from agenticx.cli.config_manager import ConfigManager  # keep the same local-import pattern used by trace_upload_enabled

        policy = ConfigManager.get_value("enterprise.agent_action_policy")
    except Exception:
        logger.debug("enterprise trace policy read failed", exc_info=True)
        return False
    if not isinstance(policy, dict):
        return False
    return policy.get("trace_content") is True or policy.get("traceContent") is True


def _redact_content(spans: list[dict[str, Any]]) -> None:
    """Remove user, reply, and reasoning excerpts from span metadata in place."""
    for span in spans:
        metadata = span.get("metadata")
        if not isinstance(metadata, dict):
            continue
        for key in _CONTENT_KEYS:
            metadata.pop(key, None)
```

Note: the existing functions `trace_upload_enabled` and `_enterprise_endpoint` already import `ConfigManager` inside the function body (circular-import guard). Follow that same existing pattern; do not move it to the top.

In `enqueue_completed_run`, between `spans = build_spans(run, events)` / `if not spans: return` and `_append_outbox(spans)`:

```python
        if not trace_content_allowed():
            _redact_content(spans)
```

Do NOT change `build_spans`; it stays a pure mapping (existing tests assert its output).

### A2. Account binding

Add:

```python
def _current_account_key() -> str:
    """Short stable id for the signed-in portal and user. Empty when unknown."""
    try:
        from agenticx.cli.config_manager import ConfigManager

        base_url = ConfigManager.get_value("enterprise.base_url")
        email = ConfigManager.get_value("enterprise.user_email")
    except Exception:
        logger.debug("enterprise trace account read failed", exc_info=True)
        return ""
    base = base_url.strip().rstrip("/") if isinstance(base_url, str) else ""
    if not base:
        return ""
    user = email.strip().lower() if isinstance(email, str) else ""
    return hashlib.sha256(f"{base}\n{user}".encode("utf-8")).hexdigest()[:16]
```

`_append_outbox(spans)`: resolve `account = _current_account_key()` once at the top, then serialize `{**span, _ACCOUNT_FIELD: account}` instead of `span`. Everything else (lock, trimming to `MAX_OUTBOX_LINES`) unchanged.

`flush_outbox`: after the `trace_upload_enabled()` early return, compute `account = _current_account_key()` once. Inside the existing `with _io_lock:` block, right after `entries = _load_entries_unlocked()`:

```python
            own = [(line, span) for line, span in entries if span.get(_ACCOUNT_FIELD) == account]
            if len(own) != len(entries):
                _write_raw_lines(outbox_path(), [line for line, _span in own])
                logger.info(
                    "enterprise trace dropped %d queued spans from another account",
                    len(entries) - len(own),
                )
            entries = own
```

Then keep the existing `if not entries: return uploaded` and batching. Lines without `_acct` (written by older versions) count as another account and are dropped; this is intended.

Before each `_post_spans(...)` call inside the loop, return `uploaded` if `_current_account_key() != account` (the token is reread per batch, so a long multi-batch flush must not continue after an account switch). Covered by `test_flush_stops_when_account_changes_between_batches`.

`_post_spans`: before posting, build the wire payload without the tag:

```python
    wire = [{k: v for k, v in span.items() if k != _ACCOUNT_FIELD} for span in spans]
```

and send `json={"spans": wire}`. `_drop_prefix_unlocked(batch_lines)` keeps matching on the raw lines, so it still works.

### A3. Module docstring

Replace the sentence "The user message and the assistant reply preview are copied, clipped to 500 characters." with: "The user message, assistant reply preview, and reasoning preview (each clipped to 500 characters) are copied only when the tenant policy sets ``trace_content``. Each outbox line is tagged with the signed-in account and is dropped, not posted, when a different account flushes."

## Tests (`tests/test_enterprise_trace.py`)

Use existing helpers `_enable`, `_isolate_config`, `_seed_outbox`, `_outbox_spans`, `_run`, `_event`, and the `httpx.MockTransport` pattern in `test_flush_outbox_status_policy`.

- Update `test_enqueue_copies_blob_usage_without_message_text`: call `_enable(monkeypatch, tmp_path, agent_action_policy={"trace_content": True})`. Its assertions stay as they are.
- New `test_enqueue_redacts_content_by_default`: same blob/event setup as above plus a `user_message` event with `payload={"text": "SECRET_USER"}`; `_enable` without policy. Assert `"visible reply"`, `"visible thought"`, `"SECRET_USER"` do not appear in `json.dumps(_outbox_spans())`; model span `input_tokens == 7`; run span exists and `metadata["agent_id"] == "meta"`.
- New parametrized `test_trace_content_allowed`: `{}` -> False; `{"agent_action_policy": {"trace_content": True}}` -> True; `{"agent_action_policy": {"traceContent": True}}` -> True; `{"agent_action_policy": {"trace_content": "true"}}` -> False; `{"agent_action_policy": []}` -> False.
- New `test_flush_drops_spans_from_other_account`: `_enable(..., user_email="a@corp.test")`, seed 2 spans, then `_enable(..., user_email="b@corp.test")` (same tmp_path is fine; it rewrites config), mock transport that records calls and returns 200. Assert `flush_outbox() == 0`, no HTTP call recorded, `_outbox_spans() == []`.
- New `test_flush_same_account_after_relogin_uploads`: seed under `user_email="a@corp.test"`, re-enable with a different `token` but same email; 200 transport; assert `flush_outbox() == 2`.
- New `test_flush_strips_account_field`: 200 transport handler parses `json.loads(request.content)` and asserts no span contains `"_acct"`.
- New `test_flush_drops_legacy_lines_without_account`: `_enable`, write one raw line `{"trace_id":"near:s:a","step_no":1,"step_kind":"run"}` directly to `enterprise_trace.outbox_path()` (mkdir parents), 200 transport; assert `flush_outbox() == 0` and the file no longer exists.
- Existing `test_outbox_drops_oldest_lines` and `test_flush_outbox_status_policy` must still pass unchanged (seeding goes through `_append_outbox`, which stamps the current account).

## Verification

```bash
cd /Users/damon/myWork/AgenticX
pytest tests/test_enterprise_trace.py -q
pytest tests -q -k "replay_ledger or enterprise" -x
```

## Acceptance

- AC-A1: default config -> outbox and HTTP body contain none of `user_text` / `reply` / `thought`.
- AC-A2: `trace_content: true` -> excerpts preserved exactly as before.
- AC-A3: another account's lines are dropped without any HTTP call; same account with a new token uploads its backlog.
- AC-A4: `_acct` never appears in the HTTP body.
- AC-A5: all pre-existing tests in the file pass (only the one test listed above gets the policy override).

## Out of scope

`build_spans` mapping logic, `error_message` content, upload batch size, retry policy, `trace_upload_enabled` semantics, any file other than the two listed.
