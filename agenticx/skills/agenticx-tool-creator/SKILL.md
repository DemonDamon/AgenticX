---
name: agenticx-tool-creator
description: Guide for creating custom tools in AgenticX including function decorator tools, MCP tool integration, tool registries, and remote tool access. Use when the user wants to create tools for agents, integrate external APIs as tools, build MCP servers, or extend agent capabilities with custom functions.
metadata:
  author: AgenticX
  version: "0.3.1"
---

# AgenticX Tool Creator

Guide for building tools that extend agent capabilities.

## Tool Architecture

AgenticX tools inherit from `BaseTool` and are consumed by agents during execution. Three approaches exist:

1. **Function decorator** (`@tool`) — fastest for simple tools
2. **Class-based** (extend `BaseTool`) — for complex or stateful tools
3. **MCP remote tools** — for external services via Model Context Protocol

## Function Decorator Tools

```python
from agenticx.tools import tool

@tool
def search_web(query: str) -> str:
    """Search the web for information.

    Args:
        query: The search query string.

    Returns:
        Search results as text.
    """
    # implementation
    return f"Results for: {query}"

@tool
def read_file(path: str) -> str:
    """Read contents of a local file."""
    with open(path) as f:
        return f.read()
```

The `@tool` decorator reads the function signature and docstring to generate the tool schema automatically. The docstring **is** the tool description the LLM sees.

## Class-Based Tools

For tools needing initialization, state, or complex logic:

```python
from agenticx.core import BaseTool

class DatabaseQuery(BaseTool):
    name = "database_query"
    description = "Query the project database."

    def __init__(self, connection_string: str):
        super().__init__()
        self.conn = connect(connection_string)

    def _run(self, sql: str) -> str:
        return self.conn.execute(sql).fetchall()
```

## Tool Registry

Register and discover tools globally:

```python
from agenticx.core import ToolRegistry

registry = ToolRegistry()
registry.register(search_web)
registry.register(read_file)

# List all registered tools
for t in registry.list_tools():
    print(f"{t.name}: {t.description}")
```

## MCP Integration

AgenticX supports the Model Context Protocol for remote tool access.

### Connecting to an MCP Server

```python
from agenticx.protocols import MCPClient

client = MCPClient(server_url="http://localhost:3000")
tools = client.list_tools()

# Use MCP tools like local tools
result = client.call_tool("search", {"query": "AI agents"})
```

### Building an MCP Server

AgenticX agents can be exposed as MCP-compatible services:

```python
from agenticx.protocols import MCPServer

server = MCPServer(host="0.0.0.0", port=3000)
server.register_tool(search_web)
server.register_tool(read_file)
server.start()
```

## Skill-Based Tools

Skills (SKILL.md bundles) are also exposed as tools via `SkillTool`:

```python
from agenticx.tools.skill_bundle import SkillBundleLoader, SkillTool

loader = SkillBundleLoader()
skill_tool = SkillTool(loader=loader)
# Agents can invoke: skill_tool("list") or skill_tool("read <skill-name>")
```

## Tool Design Guidelines

1. **Clear docstrings** — the LLM uses the docstring to decide when to call the tool
2. **Type hints** — always annotate parameters and return types
3. **Error handling** — return descriptive error messages, don't raise bare exceptions
4. **Minimal scope** — one tool, one purpose
5. **Idempotent when possible** — safe to retry without side effects
6. **Test independently** — verify tools work before attaching to agents

## Advanced: Tool Context

Tools can access execution context:

```python
@tool
def contextual_tool(query: str, _context: "ToolContext" = None) -> str:
    """A tool that uses execution context."""
    if _context:
        user = _context.user
        session = _context.session_id
    return f"Processed: {query}"
```
