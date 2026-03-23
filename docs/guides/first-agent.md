# Building Your First Agent

This guide walks through building a real-world research agent step by step.

## What We're Building

A research agent that:
1. Accepts a research topic
2. Searches the web for information
3. Synthesizes findings into a structured report

## Step 1: Set Up

```bash
pip install agenticx
export OPENAI_API_KEY="your-key"
```

## Step 2: Define Your Tools

```python
# tools.py
from agenticx.tools import tool
import httpx

@tool
def search_web(query: str) -> str:
    """Search the web for information about a topic.
    
    Args:
        query: The search query
    
    Returns:
        Search results as text
    """
    # Replace with your preferred search API
    response = httpx.get(
        "https://api.search.com/search",
        params={"q": query, "key": "your-api-key"}
    )
    return response.text

@tool
def fetch_page(url: str) -> str:
    """Fetch the content of a web page.
    
    Args:
        url: The URL to fetch
    
    Returns:
        Page content as text
    """
    response = httpx.get(url, follow_redirects=True)
    return response.text[:5000]  # First 5000 chars
```

## Step 3: Define the Agent

```python
# agent.py
from agenticx import Agent

research_agent = Agent(
    id="research-agent",
    name="Research Assistant",
    role="Senior Research Analyst",
    goal=(
        "Conduct thorough research on any given topic. "
        "Find authoritative sources, synthesize information, "
        "and produce clear, well-structured reports."
    ),
    backstory=(
        "You are an expert researcher with a background in "
        "information synthesis and critical analysis. "
        "You always cite your sources and distinguish between "
        "fact and opinion."
    ),
    organization_id="my-research-org",
    max_iter=15,
    verbose=True
)
```

## Step 4: Create and Run a Task

```python
# main.py
from agenticx import Task, AgentExecutor
from agenticx.llms import OpenAIProvider
from tools import search_web, fetch_page
from agent import research_agent

def research(topic: str) -> str:
    task = Task(
        id="research-task",
        description=f"Research the following topic and produce a comprehensive report: {topic}",
        expected_output=(
            "A structured research report with:\n"
            "1. Executive summary (2-3 sentences)\n"
            "2. Key findings (bullet points)\n"
            "3. Detailed analysis\n"
            "4. Sources and references"
        )
    )
    
    llm = OpenAIProvider(model="gpt-4o")
    executor = AgentExecutor(
        agent=research_agent,
        llm=llm,
        tools=[search_web, fetch_page]
    )
    
    return executor.run(task)

if __name__ == "__main__":
    result = research("The impact of multi-agent AI systems on software development")
    print(result)
```

## Step 5: Run It

```bash
python main.py
```

## Enhancements

### Add Memory

Keep track of past research:

```python
from agenticx.memory import MemoryManager

memory = MemoryManager()
executor = AgentExecutor(agent=research_agent, llm=llm, tools=[...], memory=memory)
```

### Add Observability

Monitor what your agent is doing:

```python
from agenticx.observability import ConsoleTracer

tracer = ConsoleTracer()
executor = AgentExecutor(agent=research_agent, llm=llm, tools=[...], tracer=tracer)
```

### Use the CLI

Scaffold and run agents from the command line:

```bash
agx project create research-bot --template basic
cd research-bot
agx run agent.py --verbose
```

## Next Steps

- [Multi-Agent Collaboration →](multi-agent.md)
- [Tool System →](../concepts/tools.md)
- [Memory System →](../concepts/memory.md)
