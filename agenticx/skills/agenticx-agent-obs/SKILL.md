---
name: agenticx-agent-obs
description: Configure AgenticX observability (Traces, Observations, Sessions, Token & latency metrics) for Near desktop, Python/TypeScript/Go agents, LangChain/LangGraph, and OpenAI-compatible apps, or diagnose failed traces and slow spans. Use when the user asks to enable trace reporting, connect AgenticX observability, inspect recent failed traces, or analyze agent latency and token consumption.
metadata:
  author: Damon Li
  version: "1.0.0"
---

# AgenticX Observability Assistant (`agenticx-agent-obs`)

Guide for connecting AI agents to the AgenticX Runtime Observability center (`/ops/logs`: Overview, Traces, Observations, Sessions) and diagnosing trace errors or latency bottlenecks.

## Core Capabilities

1. **Desktop & Local Runtime Auto-Onboarding**: Configure `~/.agenticx/config.yaml` so Near desktop sessions automatically report `run`, `model`, `tool`, and `subagent` spans (including reasoning thought previews) to the enterprise observability endpoint.
2. **Multi-Framework SDK Instrumentation**: Instrument Python (`agenticx`, `openai`, `langchain`, `langgraph`), TypeScript/Node.js, or Go services to report structured trace spans.
3. **Interactive Trace & Session Diagnosis**: Query recent traces, inspect failed `tool` / `model` / `subagent` observations, and summarize latency P50/P90 or token spikes using the bundled diagnostic script.

---

## Workflow 1 — Connect Near Desktop to Enterprise Observability

When the user wants their local Near desktop runs to appear in the Enterprise Admin Console (`运行观测`):

1. Inspect `~/.agenticx/config.yaml` under the `enterprise:` section.
2. Ensure the following keys are present (ask the user for `base_url` and `token` only if missing):
   ```yaml
   enterprise:
     enabled: true
     base_url: "<ENTERPRISE_PORTAL_URL>"
     user_email: "<USER_ACCOUNT>"
   ```
   *(The personal access credential is configured in Near Desktop Settings → Enterprise Connection.)*
3. Verify connectivity using the bundled diagnostic script (see Workflow 3).
4. Explain privacy guarantees:
   - Uploaded spans include `trace_id`, `step_no`, `step_kind` (`run` | `model` | `tool` | `subagent`), `status`, `model`, `provider`, token counts, `duration_ms`, and 500-char clipped previews of user input, assistant reply, and model reasoning (`metadata.thought`).
   - Tool arguments and raw tool outputs are never uploaded.

---

## Workflow 2 — Instrument External Agent Code (Python / LangChain / OpenAI / TS)

When the user wants to report traces from their own application code into AgenticX Observability:

1. Read `references/ingest-guide.md` in this skill directory for complete payload schemas and copy-pasteable code templates.
2. Choose the matching integration path:
   - **Desktop Ingest (`POST /api/desktop/agent-traces`)**: Uses the enterprise connection header against the Web Portal. Best for developer machines, CLI agents, and custom Python/LangGraph runners.
   - **Gateway Proxy (`:8088/v1/chat/completions`)**: Route OpenAI-compatible SDK calls through the AgenticX Go Gateway with `X-Trace-Id`, `X-Trace-Step`, and `X-Session-Id` headers for automatic span + token + cost capture.
3. Keep span hierarchies linked by setting `metadata.parent_step_no` on child `model`, `tool`, and `subagent` spans pointing to the root `run` step (or active `model` step for tool calls).

---

## Workflow 3 — Diagnose Failed Traces, Slow Spans, or Token Spikes

When the user asks *"Why did my last agent run fail?"*, *"Which tool is slowing down the session?"*, or *"Show me today's token usage and errors"*:

1. Run the bundled diagnostic script located in this skill's `scripts/diagnose_traces.py`:
   ```bash
   python3 ~/.agenticx/skills/registry/agenticx-agent-obs/scripts/diagnose_traces.py --mode summary
   ```
   *(If running from the built-in path, use the directory where this `SKILL.md` resides.)*
2. Supported flags:
   - `--mode summary`: Prints 24h KPI overview, error counts by category (`tool` / `model` / `subagent` / `run`), P50/P90 latency, and top models.
   - `--mode errors`: Lists recent failed traces and the exact observation step (`#step_no`, tool/model name, error message) that bubbled up to the trace.
   - `--trace-id <id>`: Prints the full parent-child call tree (`run` → `model` → `thought` / `tool`) and input/output previews for a single trace.
3. Summarize the root cause clearly for the user and provide actionable next steps (e.g., fixing a broken MCP tool command, adjusting model timeout, or narrowing prompt context).
