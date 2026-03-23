# agenticx.tools

## `@tool` Decorator

```python
from agenticx.tools import tool

@tool
def my_function(param: str) -> str:
    """Docstring becomes the tool description."""
    return result
```

## MCPHub

```python
from agenticx.tools.mcp import MCPHub

hub = MCPHub(servers=[{"name": "...", "command": "...", "args": [...]}])
tools = hub.get_tools()
```

## RemoteTool

```python
from agenticx.tools.remote import RemoteTool

tool = RemoteTool(name="search", endpoint="https://...", description="...")
```

## OpenAPIToolset

```python
from agenticx.tools.openapi import OpenAPIToolset

toolset = OpenAPIToolset.from_url("https://...")
```

!!! tip "Full API Reference"
    See [source on GitHub](https://github.com/DemonDamon/AgenticX/tree/main/agenticx/tools).
