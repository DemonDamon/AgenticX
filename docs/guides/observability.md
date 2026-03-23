# Observability

## Overview

Agent systems are non-deterministic, multi-step, and tool-heavy. Observability is not optional: you need a **canonical event stream** for live UX, **callbacks** for cross-cutting instrumentation, **structured logs** for support, **span trees** for nested work, **trajectories** for post-hoc reasoning, **metrics** for capacity planning, and **evaluation** for regression control.

AgenticX splits this into two layers:

| Layer | Purpose | Primary entry points |
|-------|---------|----------------------|
| **Studio / chat runtime** | Token streaming, tool rounds, confirmations, subagents | `EventType`, `RuntimeEvent`, `AgentRuntime.run_turn` (`agenticx.runtime`) |
| **Task / workflow pipeline** | Agent + Task executors, callbacks, trajectories, export | `agenticx.observability` |

!!! info "Related reference"
    For `AgentRuntime` turn semantics and per-event payloads, see [Agent runtime](../concepts/agent.md).

---

## Runtime event stream

`agenticx.runtime.events` defines the string enum `EventType` and the dataclass `RuntimeEvent`.

### `RuntimeEvent`

| Field | Type | Description |
|-------|------|-------------|
| `type` | `str` | Event name; use `EventType.<NAME>.value` when constructing. |
| `data` | `dict` | Payload (tool args, streamed text, error text, subagent metadata, etc.). |
| `agent_id` | `str` | Logical producer (`"meta"`, avatar id, etc.). |

### `EventType` (complete)

| Member | Wire value | Role |
|--------|------------|------|
| `ROUND_START` | `round_start` | New tool round; typically includes `round`, `max_rounds`. |
| `TOKEN` | `token` | Streamed model text or keep-alive pulses. |
| `TOOL_CALL` | `tool_call` | Tool name, arguments, `tool_call_id`. |
| `TOOL_RESULT` | `tool_result` | Tool output or synthetic error payload. |
| `CONFIRM_REQUIRED` | `confirm_required` | User/tool confirmation needed. |
| `CONFIRM_RESPONSE` | `confirm_response` | Gate resolved (`approved`, etc.). |
| `COMPACTION` | `compaction` | Context compaction applied. |
| `SUBAGENT_STARTED` | `subagent_started` | Delegation began. |
| `SUBAGENT_PROGRESS` | `subagent_progress` | Mid-run subagent update. |
| `SUBAGENT_CHECKPOINT` | `subagent_checkpoint` | Periodic checkpoint for long subagent runs. |
| `SUBAGENT_PAUSED` | `subagent_paused` | Subagent stopped (e.g. max rounds) without a final answer. |
| `SUBAGENT_COMPLETED` | `subagent_completed` | Subagent finished successfully. |
| `SUBAGENT_ERROR` | `subagent_error` | Subagent failed. |
| `FINAL` | `final` | Terminal natural-language reply for the turn. |
| `ERROR` | `error` | Failure, user stop, timeout, or guard abort. |

### Consuming as `AsyncGenerator`

`AgentRuntime.run_turn` yields `RuntimeEvent` instances asynchronously. Consume with `async for`:

```python
from agenticx.runtime import AgentRuntime, EventType, RuntimeEvent

async def drain_turn(runtime: AgentRuntime, ...) -> None:
    async for event in runtime.run_turn(...):
        assert isinstance(event, RuntimeEvent)
        if event.type == EventType.TOKEN.value:
            ...
        elif event.type == EventType.FINAL.value:
            break
```

---

## Callback system

The callback stack in `agenticx.observability.callbacks` targets the **core** event model (`TaskStartEvent`, `ToolCallEvent`, etc.), not `RuntimeEvent`. It is the integration point for logging, monitoring, trajectories, and WebSocket fan-out.

### Types

| Type | Role |
|------|------|
| `BaseCallbackHandler` | Abstract handler; override hooks or `on_event`. |
| `CallbackManager` | Registers handlers and dispatches `AnyEvent` synchronously or via `aprocess_event`. |
| `CallbackRegistry` | Low-level registry: handler id, per-event-type lists, global handlers, priority ordering. |

### Lifecycle and tool / LLM hooks (`BaseCallbackHandler`)

| Hook | When it runs |
|------|----------------|
| `on_workflow_start` / `on_workflow_end` | Workflow boundary. |
| `on_task_start` / `on_task_end` | Task start and completion. |
| `on_tool_start` / `on_tool_end` | Tool execution begin/end (names mirror tool runtime, not `on_tool_call`). |
| `on_llm_call` / `on_llm_response` | LLM request and structured response (semantic “start” / “end” of an LLM step). |
| `on_error` | Unhandled failure context. |
| `on_event` | Dispatches typed `AnyEvent` subclasses to the hooks above. |

!!! note "Naming"
    Typed events use `ToolCallEvent` / `ToolResultEvent` internally. Override `on_event` if you need a single entrypoint.

```python
from agenticx.observability import CallbackManager, BaseCallbackHandler
from agenticx.core.event import ToolCallEvent

class PrintTools(BaseCallbackHandler):
    def on_event(self, event):
        if isinstance(event, ToolCallEvent):
            print(event.tool_name, event.arguments)
        super().on_event(event)

mgr = CallbackManager()
mgr.register_handler(PrintTools())
```

---

## Structured logging

Module: `agenticx.observability.logging`.

| Symbol | Role |
|--------|------|
| `get_logger` | Returns a standard `logging.Logger` with a colored console formatter when no handlers are attached. |
| `StructuredLogger` | Higher-level logger with selectable `LogFormat`. |
| `LogLevel` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`. |
| `LogFormat` | `PLAIN`, `JSON`, `STRUCTURED`, `XML`. |
| `LoggingCallbackHandler` | Implements `BaseCallbackHandler` and writes execution events to logs. |

```python
from agenticx.observability import StructuredLogger, LogLevel, LogFormat, LoggingCallbackHandler

log = StructuredLogger(name="my-agent", level=LogLevel.INFO, format_type=LogFormat.JSON)
handler = LoggingCallbackHandler()
```

---

## Span tree

Module: `agenticx.observability.span_tree`. The design follows the same goals as **pydantic-evals** span trees: turn flat spans into a hierarchy for evaluation and visualization.

| Type | Role |
|------|------|
| `SpanNode` | One span: `name`, `span_id`, `parent_id`, timing, `status`, `attributes`, `children`. |
| `SpanQuery` | Declarative filter (`name`, regex, attributes, `status`, `custom_predicate`, …). |
| `SpanTree` | Container built from flat span dicts. |

### Building and querying

- **`SpanTree.from_spans(list[dict])`** — Link nodes by `parent_id`.
- **`find_spans` / `find_span`** — Match `str` name or `SpanQuery`.
- **`find_error_spans`** — Spans with `status == "error"`.
- **`to_mermaid`** — Flowchart text for MkDocs or Mermaid-enabled viewers.

```python
from agenticx.observability import SpanTree, SpanQuery

tree = SpanTree.from_spans([
    {"name": "agent.run", "span_id": "1", "parent_id": None, "status": "ok"},
    {"name": "tool.call", "span_id": "2", "parent_id": "1", "status": "error"},
])
errors = tree.find_error_spans()
diagram = tree.to_mermaid()
```

OpenTelemetry spans can be bridged into this structure via `agenticx.observability.otel` (`OTelCallbackHandler`, `SpanTreeExporter`).

---

## Execution trajectory

Module: `agenticx.observability.trajectory`.

| Type | Role |
|------|------|
| `TrajectoryStep` | One step with `step_type`, `status`, timestamps, `input_data` / `output_data`, `metadata`. |
| `ExecutionTrajectory` | Ordered steps + `TrajectoryMetadata` (tokens, cost, success counts). |
| `TrajectoryCollector` | `BaseCallbackHandler` that records steps from callback events. |

### `StepType` (shipped)

| Value | Meaning |
|-------|---------|
| `task_start` / `task_end` | Task boundaries. |
| `tool_call` / `tool_result` | Tool invocation and outcome. |
| `llm_call` / `llm_response` | LLM request/response. |
| `human_request` / `human_response` | HITL prompts and replies. |
| `error` | Failure step. |
| `finish_task` | Terminal task marker. |

### Interrupt, resume, discovery

| Concept | Typical use |
|---------|-------------|
| `INTERRUPT` | Capture state before pausing for approval or failure. |
| `RESUME` | Continue from a saved snapshot. |
| `DISCOVERY` | Exploratory branches (search, planning) you want to distinguish in traces. |

!!! warning "Enum vs. metadata"
    The Python `StepType` enum in `trajectory.py` currently lists the shipped values above. Model **interrupt / resume / discovery** either by extending `StepType` in your fork, or by encoding phase in `TrajectoryStep.metadata` while using **`ExecutionSnapshot`** (`agenticx.core.interruption`) for durable pause/resume state.

---

## Performance monitoring

Module: `agenticx.observability.monitoring`.

| Type | Role |
|------|------|
| `MetricsCollector` | Counters, gauges, histogram-style series, `PerformanceMetrics`, `SystemMetrics` history. |
| `PerformanceMetrics` | Aggregated task/tool/LLM/error stats. |
| `SystemMetrics` | CPU, memory, disk, network snapshot fields. |
| `PrometheusExporter` | Renders `MetricsCollector` state as Prometheus text (`export_metrics()`); scrape via your HTTP server or sidecar. |
| `MonitoringCallbackHandler` | Updates metrics from callback events. |

### `MetricType`

| Member | Use |
|--------|-----|
| `COUNTER` | Monotonic counts. |
| `GAUGE` | Point-in-time level. |
| `HISTOGRAM` | Distribution buckets (collector stores series you map to histogram semantics). |
| `SUMMARY` | Quantile-style rollups at export time. |

```python
from agenticx.observability import MetricsCollector, PrometheusExporter, MonitoringCallbackHandler

collector = MetricsCollector()
exporter = PrometheusExporter(collector)
text = exporter.export_metrics()  # expose on /metrics in your app
monitor = MonitoringCallbackHandler(metrics_collector=collector)
```

---

## Deep analysis

Module: `agenticx.observability.analysis`. All classes accept `ExecutionTrajectory`.

| Class | Output | LLM use |
|-------|--------|---------|
| `TrajectorySummarizer` | Structured summary dict; optional `ai_summary` | If `llm_provider` is set, adds narrative summary. |
| `FailureAnalyzer` | `FailureReport` or `None` | Heuristic typing and suggestions (`llm_provider` reserved on the instance). |
| `BottleneckDetector` | `List[AnalysisInsight]` | Heuristic (durations, repeats, token-heavy steps). |
| `PerformanceAnalyzer` | `PerformanceReport` | Wraps bottleneck detection + resource rollups. |

```python
from agenticx.observability import TrajectorySummarizer, FailureAnalyzer, BottleneckDetector, PerformanceAnalyzer

summarizer = TrajectorySummarizer(llm_provider=optional_llm)
summary = summarizer.summarize(trajectory)

failures = FailureAnalyzer().analyze_failure(trajectory)
insights = BottleneckDetector().detect_bottlenecks(trajectory)
report = PerformanceAnalyzer().analyze_performance(trajectory)
```

---

## Auto evaluation

Module: `agenticx.observability.evaluation`.

| Type | Role |
|------|------|
| `AutoEvaluator` | Scores expected vs. actual (`EvaluationResult`); LLM rubric when `llm_provider` is set, else heuristic. |
| `BenchmarkRunner` | Runs many `Task` instances, aggregates `BenchmarkResult` + `MetricsCalculator`. |
| `EvaluationMetrics` | Key-value bag of `EvaluationMetric` → float. |
| `EvaluationMetric` | Includes `SUCCESS_RATE`, `TOTAL_COST`, `ACCURACY`, `ERROR_RATE`, throughput, latency percentiles, etc. |

`MetricsCalculator` derives success rate, average duration, cost, and related stats from a list of `ExecutionTrajectory` objects.

---

## Real-time WebSocket

Module: `agenticx.observability.websocket`.

| Type | Role |
|------|------|
| `EventStream` | Tracks clients, subscriptions (`EventStreamType`), broadcast queue. |
| `WebSocketCallbackHandler` | Pushes workflow/task/tool events into `EventStream` as `EventMessage` JSON. |
| `RealtimeMonitor` | Periodic `start_monitoring` loop that samples metrics and emits `monitoring_update` messages. |

Frontends connect with a WebSocket library, subscribe to stream types, and render `EventMessage.event_type` / `event_data`. The Studio app uses its own session WebSocket/SSE paths; this module is the **reusable** building block for custom dashboards.

```python
from agenticx.observability import EventStream, WebSocketCallbackHandler, RealtimeMonitor

stream = EventStream()
ws_handler = WebSocketCallbackHandler(event_stream=stream)
monitor = RealtimeMonitor(websocket_handler=ws_handler)
# await monitor.start_monitoring()
```

---

## Data export

`DataExporter` lives in `agenticx.observability.utils` and is re-exported from `agenticx.observability`.

| Method | Format |
|--------|--------|
| `export_to_json` | JSON file |
| `export_to_csv` | CSV from `list[dict]` |
| `export_to_pickle` | Pickle blob |
| `export_trajectory_to_json` | `ExecutionTrajectory` → JSON |
| `export_trajectories_to_csv` | Summary row per trajectory |

```python
from agenticx.observability import DataExporter

exporter = DataExporter()
exporter.export_trajectory_to_json(trajectory, "run.json")
```

---

## Quick start

Wire callbacks for a single run, summarize the trajectory, and expose metrics text:

```python
from agenticx.observability import (
    CallbackManager,
    TrajectoryCollector,
    LoggingCallbackHandler,
    MonitoringCallbackHandler,
    MetricsCollector,
    PrometheusExporter,
    TrajectorySummarizer,
    DataExporter,
)

collector = MetricsCollector()
mgr = CallbackManager()
traj_handler = TrajectoryCollector()
mgr.register_handler(LoggingCallbackHandler())
mgr.register_handler(MonitoringCallbackHandler(metrics_collector=collector))
mgr.register_handler(traj_handler)

# During execution: mgr.process_event(event) for each core AnyEvent

trajectory = traj_handler.completed_trajectories[-1] if traj_handler.completed_trajectories else None
if trajectory:
    summary = TrajectorySummarizer().summarize(trajectory)
    DataExporter().export_to_json(summary, "summary.json")

prom = PrometheusExporter(collector)
open("metrics.prom", "w", encoding="utf-8").write(prom.export_metrics())
```

For **live chat** observability, consume `RuntimeEvent` from `AgentRuntime.run_turn` and map types to your UI or bridge into `EventStream` if you need WebSocket fan-out.
