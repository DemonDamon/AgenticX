# agenticx.flow

English API reference for AgenticX **flow orchestration**: decorator-driven `Flow` graphs, intervenable `ExecutionPlan` (Refly-inspired), `ExecutionPlanManager` with pluggable storage, the graph-based `WorkflowEngine`, and collaboration pattern primitives.

!!! note "Import surface"
    Most flow symbols are re-exported from `agenticx.flow`. Workflow graph models live in `agenticx.core.workflow`; the engine is `agenticx.core.workflow_engine`. Collaboration types live under `agenticx.collaboration`.

---

## 1. Flow (base class)

`Flow` is a generic, event-driven workflow base class. You declare topology with `@start`, `@listen`, and `@router`, then run via `kickoff()` (sync) or `kickoff_async()`.

### Generic state type

`Flow` is declared as `Flow(Generic[T])` where `T` is bound to `dict` **or** a Pydantic `BaseModel`:

| State kind | Typical declaration | Default when `state=None` |
|------------|---------------------|---------------------------|
| Dictionary | `class MyFlow(Flow[dict]):` | `{}` |
| Pydantic model | `class MyFlow(Flow[MyState]):` | `MyState()` if `MyState` subclasses `BaseModel` |

### FlowMeta metaclass

`FlowMeta` runs at **class creation time** and:

- Merges `_start_methods`, `_listeners`, `_routers`, and `_router_paths` from base classes.
- Scans the class namespace for flow methods (wrappers carrying `__is_start_method__`, `__trigger_methods__`, `__is_router__`, etc.).
- Registers **start** methods, **listen** conditions, **router** methods, and heuristically collects possible router return labels via `_get_possible_return_constants` (regex over `return "CONSTANT"` patterns).

### State access

| Member | Description |
|--------|-------------|
| `state` | Read/write workflow state (`T`). |
| `flow_id` | Stable instance id (`str`). |
| `execution_state` | `FlowExecutionState` for runtime bookkeeping. |
| `kickoff(inputs=None)` | Synchronous entry; may delegate to `asyncio.run` or a thread pool if a loop is already running. |
| `kickoff_async(inputs=None)` | Async entry; runs starts, then drains listeners until idle. |
| `reset()` | Clears execution state and rebuilds default `state`. |
| `get_execution_summary()` | Dict summary of ids, status, completed methods, listeners, routers. |

```python
from agenticx.flow import Flow, FlowState, start, listen

class MyState(FlowState):
    step: int = 0

class ExampleFlow(Flow[MyState]):
    @start()
    def begin(self):
        self.state.step = 1
        return "ok"

    @listen("begin")
    def after_begin(self, result=None):
        self.state.step = 2
```

---

## 2. Decorators

Import from `agenticx.flow`:

```python
from agenticx.flow import start, listen, router, or_, and_
```

### `@start`

Marks an **entry** method executed when the flow starts.

- `@start()` — unconditional start (runs in `kickoff_async` unless it has a trigger condition).
- `@start("method_name")`, `@start(some_callable)`, or `@start(and_(...))` / `@start(or_(...))` — **conditional** start: the method is registered but skipped in the initial start loop; it runs when its condition becomes satisfied like a listener.

### `@listen(method_or_condition)`

Runs the decorated method when its **trigger condition** is satisfied after other methods complete.

- Argument may be a **method name** (`str`), a **callable** (name used as trigger), or a **compound condition** from `or_()` / `and_()`.

### `@router(method_or_condition)`

Same triggering rules as `@listen`, but the method is a **router**: it should return a **string label**. That label is recorded as a **virtual completed method** so `@listen("SUCCESS")`-style edges can fire.

### `or_()` / `and_()`

| Function | Meaning | Shape |
|----------|---------|--------|
| `or_(*conditions)` | Any sub-condition satisfied | `{"type": "OR", "conditions": [...]}` |
| `and_(*conditions)` | All sub-conditions satisfied | `{"type": "AND", "conditions": [...]}` |

Each argument may be a method name, nested `or_`/`and_` dict, or a callable (uses `__name__`).

!!! warning "Listener argument passing"
    When a listener fires, trigger outputs are passed as kwargs. For a **single** trigger, the engine passes `{"result": <output>}`. For **multiple** triggers, keys are method names. Match your method signatures accordingly.

---

## 3. FlowState (state base class)

`FlowState` subclasses Pydantic `BaseModel` with:

- `model_config`: `arbitrary_types_allowed=True`, `extra="allow"`.
- `id: str` — default factory UUID.

Use it when you want typed, validated state. For unstructured bags, use `Flow[dict]` and a plain `dict`.

---

## 4. FlowExecutionState

Tracks **runtime** execution (separate from domain `Flow.state`):

| Field / API | Role |
|-------------|------|
| `flow_id` | Flow instance id |
| `completed_methods` | `set` of finished method names |
| `method_outputs` | Map method name → last output |
| `pending_triggers` | Internal listener bookkeeping |
| `execution_count` | Per-method invocation counts |
| `status` | One of `pending`, `running`, `paused`, `completed`, `failed` |
| `mark_completed(name, output)` | Record completion |
| `is_completed(name)` | Membership test |
| `get_output(name)` | Retrieve stored output |
| `check_or_condition` / `check_and_condition` | Evaluate simple triggers |
| `reset()` | Clear runtime fields |
| `to_dict` / `from_dict` | Serialization helpers |

Access from a flow: `flow.execution_state`.

---

## 5. ExecutionPlan (Refly-inspired)

Module: `agenticx.flow.execution_plan` (also exported from `agenticx.flow`).

### ExecutionStage / Subtask

| Model | Purpose |
|-------|---------|
| `Subtask` | Atomic unit: `id`, `name`, `query`, `status`, `result`, `error`, timestamps, optional `context` / `scope` / `output_requirements` |
| `ExecutionStage` | Named phase containing `subtasks`, `objectives`, `tool_categories`, `status`, progress helpers |

Related enums:

| Enum | Values (concept) |
|------|------------------|
| `SubtaskStatus` | `pending`, `executing`, `completed`, `failed` |
| `StageStatus` | `pending`, `active`, `done` |

### InterventionState

| Value | Meaning |
|-------|---------|
| `RUNNING` | Normal execution |
| `PAUSED` | Pause after current subtask (cooperative) |
| `RESUMING` | Transition back from pause |
| `RESETTING` | A node reset is in progress |

Use `confirm_running()` to return from `RESUMING` or `RESETTING` to `RUNNING`.

### Serialization and summaries

| Method | Description |
|--------|-------------|
| `to_mermaid()` | Returns a fenced Mermaid `graph TD` string for stages and subtasks (styled by status). |
| `to_execution_summary()` | Markdown-style text summary for LLM replanning context (goal, progress, epochs, intervention state, stages). |
| `to_dict()` / `from_dict()` | Pydantic `model_dump` / `model_validate` |

### Control and mutation

| Method | Description |
|--------|-------------|
| `pause()` / `resume()` | Toggle intervention state when allowed |
| `reset_node(subtask_id)` | Reset a subtask; sets `RESETTING` on success |
| `add_subtask(name, query, stage_index=None, **kwargs)` | Append `Subtask` to a stage |
| `delete_subtask(subtask_id)` | Remove by id across stages |
| `advance_stage()` | Complete current stage, bump index, activate next |
| `advance_epoch()` | Increment `current_epoch` if below `max_epochs` |
| `add_stage(stage)` | Append an `ExecutionStage` |

### Automatic progress

| Property | Formula (concept) |
|----------|-------------------|
| `ExecutionStage.progress` | Ratio of completed subtasks to total in that stage (0–100 float) |
| `ExecutionPlan.overall_progress` | Completed subtasks / total subtasks across all stages (0–100 float) |

---

## 6. ExecutionPlanManager

Module: `agenticx.flow.execution_plan_manager`.

### CRUD and persistence

| Method | Description |
|--------|-------------|
| `register(plan)` | Cache plan, emit `plan_registered` |
| `get(session_id)` | Cache-first, then storage |
| `get_or_create(session_id, goal, **kwargs)` | Load or instantiate + register |
| `update(plan)` | Replace cache entry, emit `plan_updated` |
| `delete(session_id)` | Remove from cache and/or storage |
| `list_sessions()` | Union of cached and stored ids |
| `persist` / `persist_all` | Write through to storage |
| `load(session_id)` | Force load from storage into cache |

Constructor: `ExecutionPlanManager(storage=None, auto_persist=False)`.

### InMemoryPlanStorage / FilePlanStorage

| Class | Behavior |
|-------|----------|
| `InMemoryPlanStorage` | Dict-backed; no disk IO |
| `FilePlanStorage` | JSON files under `storage_dir` (default `.agenticx/plans`) |

Custom backends implement `PlanStorageProtocol`: `save_plan`, `load_plan`, `delete_plan`, `list_plans`.

### Events

Register with `on(event_type, callback)` or decorators such as `on_plan_updated`, `on_plan_paused`, `on_plan_resumed`. Callbacks receive `PlanEvent` (`event_type`, `session_id`, `timestamp`, optional `data`).

Helper APIs (`add_subtask_to_plan`, `delete_subtask_from_plan`, `update_subtask_status`, `pause_plan`, `resume_plan`, `reset_subtask`) wrap plan mutations and emit typed events.

---

## 7. WorkflowEngine (`agenticx/core/workflow_engine.py`)

Graph orchestration distinct from decorator `Flow`: uses `Workflow` / `WorkflowNode` / `WorkflowEdge` from `agenticx.core.workflow` plus runtime `WorkflowGraph` in the engine module.

### Core models (`agenticx.core.workflow`)

| Model | Fields (high level) |
|-------|---------------------|
| `WorkflowNode` | `id`, `type`, `name`, `config` |
| `WorkflowEdge` | `source`, `target`, optional `condition`, `metadata` |
| `Workflow` | `id`, `name`, `version`, `organization_id`, `nodes`, `edges`, `metadata` |

### WorkflowGraph / WorkflowEngine

- **WorkflowGraph** builds an executable graph: `add_node`, `add_edge`, `get_next_nodes` (evaluates optional Python `condition` callables stored on edges), `get_entry_nodes`, `validate`.
- **WorkflowEngine.run(workflow, initial_data=None, execution_id=None)** executes asynchronously, records events on `ExecutionContext.event_log`, and propagates to **next** nodes after each completion.

### Sequential / parallel / conditional behavior

- **Parallelism**: multiple **entry** nodes start concurrently; `_execute_nodes` uses `asyncio.gather`.
- **Sequential**: edges chain `source → target`; a single successor runs after its predecessor completes.
- **Conditional**: `WorkflowGraph.add_edge(..., condition=callable)` — edges whose condition fails are skipped when selecting `get_next_nodes`.

### `max_concurrent_nodes`

`WorkflowEngine(..., max_concurrent_nodes=10)` — `asyncio.Semaphore` caps how many nodes run at once inside `_execute_nodes`.

---

## 8. Collaboration patterns (`agenticx/collaboration/`)

### CollaborationMode

| Member | Role (short) |
|--------|----------------|
| `MASTER_SLAVE` | Hierarchical control |
| `REFLECTION` | Review / improve loops |
| `DEBATE` | Adversarial or multi-view discussion |
| `GROUP_CHAT` | Conversational coordination |
| `PARALLEL` | Concurrent workers |
| `NESTED` | Patterns composed inside patterns |
| `DYNAMIC` | Runtime participant changes |
| `ASYNC` | Event-driven async collaboration |
| `ROLE_PLAYING` | Role-specialized agents |
| `WORKFORCE` | Workforce-style orchestration |

Defined in `agenticx.collaboration.enums`.

### BaseCollaborationPattern

Abstract base in `agenticx.collaboration.base`:

- Constructed with `agents: List[Agent]` and `CollaborationConfig`.
- Holds `collaboration_id`, `state: CollaborationStatus`, and per-agent state.
- **Abstract** `execute(self, task: str, **kwargs) -> CollaborationResult`.
- Utilities: `get_collaboration_state`, `add_agent`, `remove_agent`, `update_state`, `log_message`, `get_agent_by_id`, `get_agents_by_role`.

Concrete patterns (e.g. `MasterSlavePattern`, `GroupChatPattern`, `WorkforcePattern`) subclass this type.

---

## Quick import cheat sheet

```python
# Decorator flow
from agenticx.flow import (
    Flow, FlowState, FlowMeta, FlowExecutionState,
    start, listen, router, or_, and_,
    ExecutionPlan, ExecutionStage, Subtask, InterventionState,
    ExecutionPlanManager, InMemoryPlanStorage, FilePlanStorage, PlanEvent,
)

# Graph workflow engine
from agenticx.core.workflow import Workflow, WorkflowNode, WorkflowEdge
from agenticx.core.workflow_engine import WorkflowEngine, WorkflowGraph

# Collaboration
from agenticx.collaboration import BaseCollaborationPattern, CollaborationMode
```
