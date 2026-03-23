# Orchestration

## Overview

AgenticX provides two complementary orchestration approaches:

- **Graph-based Workflows** — explicit DAG with nodes and edges, full control
- **Flow Decorators** — lightweight pipeline definition with Python decorators

## Graph-based Workflow

```python
from agenticx.flow import Workflow, Node, Edge

workflow = Workflow(id="research-pipeline")

# Define nodes (each node is an agent task)
fetch = Node(id="fetch", agent=fetch_agent, task=fetch_task)
analyze = Node(id="analyze", agent=analyze_agent, task=analyze_task)
report = Node(id="report", agent=report_agent, task=report_task)

# Define edges (data flow)
workflow.add_edge(Edge(source="fetch", target="analyze"))
workflow.add_edge(Edge(source="analyze", target="report"))

result = workflow.run()
```

## Conditional Routing

```python
from agenticx.flow import ConditionalEdge

def route_based_on_result(output):
    if output.confidence > 0.8:
        return "publish"
    else:
        return "review"

workflow.add_edge(
    ConditionalEdge(
        source="analyze",
        condition=route_based_on_result,
        targets={"publish": publish_node, "review": review_node}
    )
)
```

## Parallel Execution

```python
from agenticx.flow import ParallelNode

# Run multiple agents concurrently
parallel = ParallelNode(
    id="parallel-research",
    nodes=[fetch_news, fetch_papers, fetch_code],
    merge_strategy="concat"
)
workflow.add_node(parallel)
```

## Flow Decorators

For simpler pipelines, use the `@flow` decorator system:

```python
from agenticx.flow import flow, step

@flow
class ResearchPipeline:

    @step
    def fetch_data(self, query: str) -> str:
        return self.fetch_agent.run(query)

    @step
    def analyze(self, data: str) -> dict:
        return self.analyze_agent.run(data)

    @step
    def generate_report(self, analysis: dict) -> str:
        return self.report_agent.run(analysis)

pipeline = ResearchPipeline()
result = pipeline.run(query="Latest AI research")
```

## Execution Plans

For complex multi-step tasks, use execution plans:

```python
from agenticx.planner import ExecutionPlan, PlanStep

plan = ExecutionPlan(
    steps=[
        PlanStep(id="1", description="Gather requirements", agent=analyst),
        PlanStep(id="2", description="Design architecture", agent=architect, depends_on=["1"]),
        PlanStep(id="3", description="Implement features", agent=developer, depends_on=["2"]),
        PlanStep(id="4", description="Write tests", agent=tester, depends_on=["3"]),
    ]
)

results = plan.execute()
```
