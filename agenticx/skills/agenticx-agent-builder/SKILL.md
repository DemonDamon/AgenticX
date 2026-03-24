---
name: agenticx-agent-builder
description: Guide for creating and configuring AgenticX agents with roles, goals, tools, LLM providers, and execution strategies. Use when the user wants to create agents, assign tools to agents, configure LLM backends, set up agent execution, or build multi-agent systems.
metadata:
  author: AgenticX
  version: "0.3.3"
---

# AgenticX Agent Builder

Guide for creating production-grade agents in AgenticX.

## Core Concepts

An Agent in AgenticX consists of:
- **Identity**: id, name, role, goal
- **LLM Provider**: the language model backend
- **Tools**: functions the agent can invoke
- **Executor**: the runtime that orchestrates agent reasoning

## Creating an Agent

### Minimal Agent

```python
from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider

agent = Agent(
    id="assistant",
    name="Assistant",
    role="General Purpose Assistant",
    goal="Help users with tasks",
    organization_id="default"
)
```

### Agent with Rich Configuration

```python
agent = Agent(
    id="research-analyst",
    name="Research Analyst",
    role="Senior Research Analyst",
    goal="Produce thorough, well-cited research reports",
    backstory="10 years experience in data-driven research",
    organization_id="research-team",
    verbose=True
)
```

### CLI Creation

```bash
agx agent create research-analyst --role "Senior Research Analyst"
agx agent list
```

## LLM Providers

AgenticX supports multiple LLM backends through a unified interface:

```python
from agenticx.llms import OpenAIProvider, LiteLLMProvider

# OpenAI
llm = OpenAIProvider(model="gpt-4")

# Any model via LiteLLM (Claude, Gemini, local models, etc.)
llm = LiteLLMProvider(model="anthropic/claude-sonnet-4-20250514")
llm = LiteLLMProvider(model="ollama/llama3")
```

## Adding Tools

### Function Decorator Tools

```python
from agenticx.tools import tool

@tool
def search_web(query: str) -> str:
    """Search the web for information."""
    return f"Results for: {query}"

@tool
def calculate(expression: str) -> float:
    """Evaluate a math expression safely."""
    return eval(expression)  # use ast.literal_eval in production
```

### Attaching Tools to Execution

```python
executor = AgentExecutor(
    agent=agent,
    llm=llm,
    tools=[search_web, calculate]
)
result = executor.run(task)
```

## Task Definition

```python
task = Task(
    id="research-task",
    description="Research the latest trends in AI agents",
    expected_output="A structured report with sections and citations",
    context={"domain": "artificial-intelligence"}
)
```

### Output Validation

AgenticX validates task outputs using Pydantic:

```python
from pydantic import BaseModel

class ResearchReport(BaseModel):
    title: str
    summary: str
    findings: list[str]

task = Task(
    id="validated-task",
    description="Research AI trends",
    expected_output="Structured research report",
    output_model=ResearchReport
)
```

## Execution Strategies

### Basic Execution

```python
executor = AgentExecutor(agent=agent, llm=llm)
result = executor.run(task)
```

### With Events & Callbacks

AgenticX emits events during execution (TaskStart, ToolCall, LLMCall, etc.):

```python
from agenticx.core import EventLog

event_log = EventLog()
executor = AgentExecutor(agent=agent, llm=llm, event_log=event_log)
result = executor.run(task)

for event in event_log.events:
    print(f"{event.type}: {event.data}")
```

## Multi-Agent Patterns

### Agent Handoff

```python
from agenticx.core import HandoffOutput

# Agent A can hand off to Agent B
handoff = HandoffOutput(target_agent="agent-b", context={"data": result})
```

### Communication Interface

```python
from agenticx.core import BroadcastCommunication

comm = BroadcastCommunication()
comm.send(sender="agent-a", message="Task complete", data=result)
```

## GuideRails

Constrain agent behavior with guardrails:

```python
from agenticx.core import GuideRails, GuideRailsConfig

config = GuideRailsConfig(
    max_iterations=10,
    timeout_seconds=60,
    abort_on_failure=True
)
guardrails = GuideRails(config=config)
```

## Best Practices

1. **Specific roles** — narrow roles produce better results than generic ones
2. **Clear goals** — state what success looks like
3. **Minimal tools** — only attach tools the agent actually needs
4. **Output validation** — use Pydantic models for structured outputs
5. **Event logging** — always enable for debugging and monitoring
