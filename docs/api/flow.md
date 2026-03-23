# agenticx.flow

## Workflow

```python
from agenticx.flow import Workflow, Node, Edge

workflow = Workflow(id="my-pipeline")
workflow.add_node(Node(id="step1", agent=agent1, task=task1))
workflow.add_node(Node(id="step2", agent=agent2, task=task2))
workflow.add_edge(Edge(source="step1", target="step2"))
result = workflow.run()
```

## `@flow` / `@step` Decorators

```python
from agenticx.flow import flow, step

@flow
class MyPipeline:
    @step
    def first(self, input: str) -> str: ...

    @step
    def second(self, result: str) -> dict: ...
```

!!! tip "Full API Reference"
    See [source on GitHub](https://github.com/DemonDamon/AgenticX/tree/main/agenticx/flow).
