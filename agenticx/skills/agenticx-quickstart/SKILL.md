---
name: agenticx-quickstart
description: AgenticX zero-to-hero quickstart guide. Use when the user wants to get started with AgenticX, create their first project, build their first agent, or run their first workflow. Covers installation, project scaffolding, agent creation, task execution, and CLI basics.
metadata:
  author: AgenticX
  version: "0.3.7"
---

# AgenticX Quickstart

Guide for getting a user from zero to a running AgenticX agent in under 5 minutes.

## Installation

```bash
# Core install (lightweight, ~27 deps, installs in seconds)
pip install agenticx

# Verify
agx --version
```

Optional extras — install only what you need:

| Extra | What it adds | Command |
|-------|-------------|---------|
| `memory` | Mem0, ChromaDB, Qdrant | `pip install "agenticx[memory]"` |
| `document` | PDF/PPT/Word parsing | `pip install "agenticx[document]"` |
| `server` | API server (`agx serve`) | `pip install "agenticx[server]"` |
| `volcengine` | Volcengine AgentKit | `pip install "agenticx[volcengine]"` |
| `all` | Everything | `pip install "agenticx[all]"` |

## Environment

```bash
export OPENAI_API_KEY="sk-..."
# Optional
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Create a Project

```bash
agx project create my-first-agent --template basic
cd my-first-agent
agx project info
```

## Create Your First Agent (Python)

```python
from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider

agent = Agent(
    id="data-analyst",
    name="Data Analyst",
    role="Data Analysis Expert",
    goal="Help users analyze and understand data",
    organization_id="my-org"
)

task = Task(
    id="analysis-task",
    description="Analyze sales data trends",
    expected_output="Detailed analysis report"
)

llm = OpenAIProvider(model="gpt-4")
executor = AgentExecutor(agent=agent, llm=llm)
result = executor.run(task)
print(result)
```

## Create via CLI

```bash
# Scaffold an agent
agx agent create researcher --role "Senior Research Analyst"
agx agent list

# Scaffold a workflow
agx workflow create research-pipeline --agents "researcher"

# Run it
agx run workflows/research-pipeline.py --verbose
```

## Add Tools

```python
from agenticx.tools import tool

@tool
def calculate_sum(x: int, y: int) -> int:
    """Calculate the sum of two numbers."""
    return x + y

# Pass tools when creating agent or executor
```

## Essential CLI Commands

| Command | Purpose |
|---------|---------|
| `agx` | Welcome page with common commands |
| `agx --help` | Full help |
| `agx project create NAME` | Scaffold a project |
| `agx agent create NAME` | Create an agent |
| `agx workflow create NAME` | Create a workflow |
| `agx run FILE` | Execute a workflow file |
| `agx serve` | Start API server |
| `agx skills list` | List installed skills |
| `agx hooks list` | List available hooks |

## Next Steps

- Build complex agents → use the **agenticx-agent-builder** skill
- Design workflows → use the **agenticx-workflow-designer** skill
- Create custom tools → use the **agenticx-tool-creator** skill
- Deploy to production → use the **agenticx-deployer** skill
