# agenticx.agents

## Agent

```python
class Agent(BaseModel):
    id: str
    name: str
    role: str
    goal: str
    backstory: str = ""
    organization_id: str
    max_iter: int = 10
    verbose: bool = False
```

The core agent definition. Agents are stateless — all state lives in the executor context.

## AgentExecutor

```python
class AgentExecutor:
    def __init__(
        self,
        agent: Agent,
        llm: BaseLLMProvider,
        tools: list[Callable] = [],
        memory: MemoryManager | None = None,
        tracer: BaseTracer | None = None,
        human_in_the_loop: HumanInTheLoop | None = None,
        sanitizer: InputSanitizer | None = None,
        policy: PolicyEngine | None = None,
    ): ...

    def run(self, task: Task) -> str: ...
    async def arun(self, task: Task) -> str: ...
```

## Task

```python
class Task(BaseModel):
    id: str = ""
    description: str
    expected_output: str = ""
    context: dict = {}
```

!!! tip "Full API Reference"
    Auto-generated API docs from source code are coming soon. In the meantime, refer to the [source on GitHub](https://github.com/DemonDamon/AgenticX/tree/main/agenticx/agents).
