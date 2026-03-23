# Multi-Agent Collaboration

## Overview

AgenticX is designed from the ground up for multi-agent systems. Multiple agents can collaborate on complex tasks through delegation, parallel execution, and structured communication protocols.

## Agent Teams

```python
from agenticx.runtime import AgentTeamManager
from agenticx import Agent
from agenticx.llms import OpenAIProvider

llm = OpenAIProvider(model="gpt-4o")

# Define team members
researcher = Agent(id="researcher", name="Researcher", role="Information Gatherer",
                   goal="Find accurate information", organization_id="team")
analyst = Agent(id="analyst", name="Analyst", role="Data Analyst",
                goal="Analyze and interpret data", organization_id="team")
writer = Agent(id="writer", name="Writer", role="Content Writer",
               goal="Produce clear written content", organization_id="team")

# Team manager handles concurrency, session isolation, and agent lifecycle
team = AgentTeamManager(agents=[researcher, analyst, writer], max_concurrency=3)
```

## Meta-Agent Pattern

The Meta-Agent acts as a CEO/project manager, dispatching work to specialized sub-agents:

```
User Request
    ↓
Meta-Agent (analyzes, plans, delegates)
    ↓
┌───────────────────────────────┐
│  Researcher │ Analyst │ Writer │  ← Sub-agents running concurrently
└───────────────────────────────┘
    ↓
Meta-Agent (aggregates, synthesizes)
    ↓
Final Response to User
```

The Meta-Agent maintains an active snapshot of all running sub-agents and injects their status into its system prompt each turn.

## A2A Communication Protocol

Agents can communicate directly using the A2A (Agent-to-Agent) protocol:

```python
from agenticx.protocols.a2a import A2AClient, A2AServer, AgentCard

# Publish an agent as an A2A service
card = AgentCard(
    agent_id="researcher",
    skills=["web_search", "document_analysis"],
    endpoint="http://localhost:8001"
)
server = A2AServer(agent=researcher, card=card)
server.start()

# Another agent calls it
client = A2AClient()
result = client.invoke_skill(
    agent_id="researcher",
    skill="web_search",
    params={"query": "latest AI papers"}
)
```

## Parallel Execution

Run multiple agents simultaneously:

```python
from agenticx.flow import ParallelExecutor

executor = ParallelExecutor(max_workers=4)

tasks = [
    (researcher, Task(description="Research topic A")),
    (researcher, Task(description="Research topic B")),
    (researcher, Task(description="Research topic C")),
]

results = executor.run_all(tasks)
```

## Human-in-the-Loop

Pause agent execution to get human approval:

```python
from agenticx.runtime import HumanInTheLoop

hitl = HumanInTheLoop(
    trigger_on=["tool_call:delete_file", "tool_call:send_email"],
    timeout_seconds=300,
    default_action="reject"  # auto-reject if no human response
)

executor = AgentExecutor(agent=agent, llm=llm, human_in_the_loop=hitl)
```

## Session Isolation

Each agent team run is isolated by `owner_session_id`, preventing cross-contamination between concurrent sessions. The global registry allows looking up agent status across sessions for monitoring purposes.
