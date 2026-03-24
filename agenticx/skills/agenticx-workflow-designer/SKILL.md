---
name: agenticx-workflow-designer
description: Guide for designing and running AgenticX workflows including sequential pipelines, parallel execution, graph-based orchestration, conditional routing, and trigger services. Use when the user wants to create workflows, orchestrate multiple agents, design agent pipelines, or set up complex multi-step processes.
metadata:
  author: AgenticX
  version: "0.3.2"
---

# AgenticX Workflow Designer

Guide for building workflows that orchestrate agents, tasks, and execution paths.

## Core Components

| Component | Purpose |
|-----------|---------|
| `Workflow` | Container for nodes and edges |
| `WorkflowNode` | A step in the workflow (agent + task) |
| `WorkflowEdge` | Connection between nodes (with optional conditions) |
| `WorkflowEngine` | Runtime executor for the workflow graph |
| `WorkflowGraph` | Graph representation of the workflow |

## Basic Workflow

```python
from agenticx import Workflow, WorkflowNode, WorkflowEdge
from agenticx.core import WorkflowEngine

# Define nodes
research_node = WorkflowNode(
    id="research",
    agent=researcher_agent,
    task=research_task
)

analysis_node = WorkflowNode(
    id="analysis",
    agent=analyst_agent,
    task=analysis_task
)

# Define edges (sequential flow)
edge = WorkflowEdge(source="research", target="analysis")

# Build workflow
workflow = Workflow(
    id="research-pipeline",
    nodes=[research_node, analysis_node],
    edges=[edge]
)

# Execute
engine = WorkflowEngine()
result = engine.run(workflow)
```

## CLI Workflow Creation

```bash
# Create workflow scaffold
agx workflow create research-pipeline --agents "researcher,analyst"

# List workflows
agx workflow list

# Run a workflow file
agx run workflows/research-pipeline.py --verbose
```

## Workflow Patterns

### Sequential Pipeline

Nodes execute one after another:

```
[Research] → [Analysis] → [Report]
```

```python
edges = [
    WorkflowEdge(source="research", target="analysis"),
    WorkflowEdge(source="analysis", target="report"),
]
```

### Parallel Execution

Multiple nodes execute concurrently:

```
         ┌→ [Web Search] ─┐
[Start] ─┤                 ├→ [Merge]
         └→ [DB Query]   ─┘
```

```python
edges = [
    WorkflowEdge(source="start", target="web-search"),
    WorkflowEdge(source="start", target="db-query"),
    WorkflowEdge(source="web-search", target="merge"),
    WorkflowEdge(source="db-query", target="merge"),
]
```

### Conditional Routing

Route execution based on output:

```python
edge = WorkflowEdge(
    source="classifier",
    target="handler-a",
    condition=lambda result: result.get("category") == "A"
)
```

### Graph-Based Orchestration

For complex DAGs with multiple paths and merge points, use `WorkflowGraph`:

```python
from agenticx.core import WorkflowGraph

graph = WorkflowGraph()
graph.add_node(research_node)
graph.add_node(analysis_node)
graph.add_node(report_node)
graph.add_edge("research", "analysis")
graph.add_edge("analysis", "report")
```

## Triggers

### Scheduled Trigger

```python
from agenticx.core import TriggerService, ScheduledTrigger

trigger = ScheduledTrigger(
    cron="0 9 * * 1",  # Every Monday at 9am
    workflow_id="weekly-report"
)
service = TriggerService()
service.register(trigger)
```

### Event-Driven Trigger

```python
from agenticx.core import EventDrivenTrigger

trigger = EventDrivenTrigger(
    event_type="new_data_available",
    workflow_id="data-pipeline"
)
```

## Execution Context

Track workflow state during execution:

```python
from agenticx.core import ExecutionContext, WorkflowStatus

context = ExecutionContext(workflow_id="research-pipeline")
# context.status → WorkflowStatus.RUNNING / COMPLETED / FAILED
# context.node_results → dict of node_id → result
```

## Running Workflow Files

```bash
# Simple run
agx run my_workflow.py

# With config file
agx run my_workflow.py --config config.yaml --verbose

# Debug mode
agx run my_workflow.py --debug
```

## Best Practices

1. **Start simple** — begin with sequential, add complexity as needed
2. **Name nodes clearly** — they appear in logs and monitoring
3. **Set timeouts** — prevent infinite loops in conditional workflows
4. **Use validation** — validate outputs at each node boundary
5. **Monitor execution** — enable observability for production workflows
