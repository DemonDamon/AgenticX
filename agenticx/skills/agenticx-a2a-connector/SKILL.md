---
name: agenticx-a2a-connector
description: Guide for using the A2A (Agent-to-Agent) communication protocol in AgenticX including agent discovery, skill invocation, remote agent cards, and distributed agent systems. Use when the user wants agents to communicate with each other, set up distributed agent systems, invoke remote agent skills, or build agent-to-agent workflows.
metadata:
  author: AgenticX
  version: "0.3.7"
---

# AgenticX A2A Connector

Guide for building distributed, inter-communicating agent systems using the A2A protocol.

## What is A2A?

A2A (Agent-to-Agent) is a protocol that enables agents to discover each other's capabilities and invoke them as if they were local tools. This allows building distributed agent systems where specialized agents collaborate across network boundaries.

## Core Components

| Component | Purpose |
|-----------|---------|
| `AgentCard` | Advertises an agent's identity and skills |
| `Skill` | Describes a capability an agent offers |
| `A2ASkillTool` | Wraps a remote skill as a local tool |
| `A2ASkillToolFactory` | Batch-creates tools from an AgentCard |
| `A2AClient` | HTTP client for calling remote agents |

## Agent Cards

An AgentCard declares what an agent can do:

```python
from agenticx.protocols import AgentCard, Skill

card = AgentCard(
    name="Research Agent",
    description="Specializes in web research and report generation",
    url="http://research-agent:8000",
    skills=[
        Skill(
            name="web_research",
            description="Search the web and compile findings",
            parameters_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "depth": {"type": "integer", "default": 3}
                },
                "required": ["query"]
            }
        ),
        Skill(
            name="generate_report",
            description="Generate a structured report from research data",
            parameters_schema={
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "format": {"type": "string", "enum": ["markdown", "html"]}
                },
                "required": ["topic"]
            }
        )
    ]
)
```

## Using Remote Agent Skills as Tools

### Single Skill

```python
from agenticx.protocols import A2ASkillTool

tool = A2ASkillTool(
    agent_url="http://research-agent:8000",
    skill_name="web_research"
)

# Use like any local tool
result = tool.run(query="latest AI trends", depth=5)
```

### All Skills from an Agent

```python
from agenticx.protocols import A2ASkillToolFactory

factory = A2ASkillToolFactory()
tools = factory.create_tools(agent_card=card)

# tools is a list of A2ASkillTool instances, one per skill
for t in tools:
    print(f"Tool: {t.name} — {t.description}")
```

## A2A Client

Low-level client for direct communication:

```python
from agenticx.protocols import A2AClient

client = A2AClient(base_url="http://research-agent:8000")

# Discover capabilities
card = client.get_agent_card()

# Invoke a skill
result = client.invoke_skill(
    skill_name="web_research",
    parameters={"query": "quantum computing", "depth": 3}
)
```

## Building an A2A-Enabled Agent

Expose your agent as an A2A service:

```python
from agenticx import Agent
from agenticx.protocols import A2AServer

agent = Agent(
    id="specialist",
    name="Data Specialist",
    role="Data Analysis",
    goal="Analyze datasets",
    organization_id="team-a"
)

server = A2AServer(agent=agent, port=8001)
server.register_skill(
    name="analyze_data",
    handler=my_analysis_function,
    description="Analyze a dataset and return insights"
)
server.start()
```

## Multi-Agent Architecture Pattern

```
┌─────────────────┐     A2A      ┌──────────────────┐
│  Orchestrator    │────────────→│  Research Agent   │
│  Agent           │             │  (port 8001)      │
│  (port 8000)     │             └──────────────────┘
│                  │     A2A      ┌──────────────────┐
│                  │────────────→│  Analysis Agent   │
│                  │             │  (port 8002)      │
└─────────────────┘             └──────────────────┘
```

The Orchestrator discovers remote agents via their AgentCards and invokes their skills as tools within its own workflow.

## CLI for A2A

```bash
# Start an agent as an A2A service
agx serve --port 8001

# The serve command exposes:
# - GET  /.well-known/agent-card  → AgentCard JSON
# - POST /tasks/submit            → Invoke skills
```

## Best Practices

1. **Version your skills** — include version in AgentCard metadata
2. **Schema validation** — always define `parameters_schema` for skills
3. **Timeout handling** — set reasonable timeouts for remote calls
4. **Retry logic** — implement retries for network failures
5. **Health checks** — use `/health` endpoints before routing traffic
6. **Security** — authenticate A2A calls in production environments
