# Quick Start

Get up and running in 5 minutes.

## 1. Install

```bash
pip install agenticx
```

## 2. Create Your First Agent

```python
from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider

# Define the agent
agent = Agent(
    id="data-analyst",
    name="Data Analyst",
    role="Data Analysis Expert",
    goal="Help users analyze and understand data",
    organization_id="my-org"
)

# Define a task
task = Task(
    id="analysis-task",
    description="Analyze sales data trends for Q4 2025",
    expected_output="A detailed analysis report with key insights"
)

# Run
llm = OpenAIProvider(model="gpt-4o")
executor = AgentExecutor(agent=agent, llm=llm)
result = executor.run(task)
print(result)
```

## 3. Add Tools

Give your agent the ability to call custom functions:

```python
from agenticx.tools import tool
from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider

@tool
def calculate_sum(x: int, y: int) -> int:
    """Calculate the sum of two numbers."""
    return x + y

@tool
def search_web(query: str) -> str:
    """Search the web for information."""
    # integrate with your search provider
    return f"Results for: {query}"

agent = Agent(
    id="assistant",
    name="Assistant",
    role="General Assistant",
    goal="Help with any task",
    organization_id="my-org"
)

task = Task(
    description="What is 42 + 58?",
    expected_output="The numerical answer"
)

executor = AgentExecutor(agent=agent, llm=OpenAIProvider(), tools=[calculate_sum, search_web])
result = executor.run(task)
```

## 4. CLI Quick Start

After installation, the `agx` CLI is available:

```bash
# Create a new project
agx project create my-agent --template basic
cd my-agent

# Start the Studio API server
agx serve --port 8000

# Run a workflow file
agx run workflows/my_pipeline.py --verbose
```

## 5. Use the Studio UI

AgenticX ships with a web-based Studio for managing agents, sessions, and group chats:

```bash
agx serve --port 8000
# Open http://localhost:8000 in your browser
```

## Next Steps

- [Configuration →](configuration.md)
- [Agent Core concepts →](../concepts/agent.md)
- [Multi-Agent Collaboration →](../guides/multi-agent.md)
- [CLI Reference →](../cli.md)
