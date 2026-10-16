# AgenticX Observability Ingest & Instrumentation Guide

This reference documents the HTTP endpoints, span schema, and SDK snippets for reporting traces and sessions to AgenticX Observability.

## 1. Span Schema (`DesktopTraceSpan`)

Endpoint: `POST <PORTAL_BASE_URL>/api/desktop/agent-traces`
Headers:
- `Content-Type: application/json`

Request body:

```json
{
  "spans": [
    {
      "trace_id": "near:session-uuid:run-uuid",
      "step_no": 1,
      "step_kind": "model",
      "status": "ok",
      "model": "glm-5.3-flash",
      "provider": "zhipu",
      "input_tokens": 820,
      "output_tokens": 240,
      "reasoning_tokens": 60,
      "total_tokens": 1120,
      "duration_ms": 1420,
      "cost_usd": 0,
      "metadata": {
        "parent_step_no": 3,
        "thought": "Brief reasoning summary...",
        "reply": "Assistant output preview..."
      }
    },
    {
      "trace_id": "near:session-uuid:run-uuid",
      "step_no": 2,
      "step_kind": "tool",
      "status": "ok",
      "input_tokens": 0,
      "output_tokens": 0,
      "reasoning_tokens": 0,
      "total_tokens": 0,
      "duration_ms": 310,
      "cost_usd": 0,
      "metadata": {
        "parent_step_no": 1,
        "tool_name": "web_search"
      }
    },
    {
      "trace_id": "near:session-uuid:run-uuid",
      "step_no": 3,
      "step_kind": "run",
      "status": "ok",
      "model": "glm-5.3-flash",
      "provider": "zhipu",
      "input_tokens": 820,
      "output_tokens": 240,
      "reasoning_tokens": 60,
      "total_tokens": 1120,
      "duration_ms": 1850,
      "cost_usd": 0,
      "metadata": {
        "agent_id": "meta",
        "event_count": 6,
        "user_text": "User question preview..."
      }
    }
  ]
}
```

### Field Rules
- `trace_id`: Use `near:<session_id>:<run_id>` so the observability center automatically groups runs into **Sessions** and tags the source.
- `step_kind`: Must be one of `"run"`, `"model"`, `"tool"`, `"subagent"`.
- `status`: Must be one of `"ok"`, `"error"`, `"cancelled"`.
- `metadata.parent_step_no`: Links `model` and `subagent` spans under the root `run` step, and `tool` spans under the triggering `model` step.

---

## 2. Python / LangChain / LangGraph Reporter Snippet

```python
import time
import uuid
import urllib.request
import json

class AgenticXTraceReporter:
    def __init__(self, base_url: str, auth_header: str, session_id: str | None = None):
        self.base_url = base_url.rstrip("/")
        self.auth_header = auth_header
        self.session_id = session_id or str(uuid.uuid4())

    def report_run(self, user_text: str, reply_text: str, model: str, input_tokens: int, output_tokens: int, duration_ms: int, status: str = "ok", thought: str = ""):
        run_id = uuid.uuid4().hex
        trace_id = f"near:{self.session_id}:{run_id}"
        total = input_tokens + output_tokens
        spans = [
            {
                "trace_id": trace_id,
                "step_no": 1,
                "step_kind": "model",
                "status": status,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "reasoning_tokens": 0,
                "total_tokens": total,
                "duration_ms": duration_ms,
                "cost_usd": 0,
                "metadata": {"parent_step_no": 2, "reply": reply_text[:500], "thought": thought[:500]},
            },
            {
                "trace_id": trace_id,
                "step_no": 2,
                "step_kind": "run",
                "status": status,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "reasoning_tokens": 0,
                "total_tokens": total,
                "duration_ms": duration_ms,
                "cost_usd": 0,
                "metadata": {"agent_id": "custom-agent", "user_text": user_text[:500]},
            },
        ]
        req = urllib.request.Request(
            f"{self.base_url}/api/desktop/agent-traces",
            data=json.dumps({"spans": spans}).encode("utf-8"),
            headers={
                "Authorization": self.auth_header,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
```
