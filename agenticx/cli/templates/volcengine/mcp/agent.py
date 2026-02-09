#!/usr/bin/env python3
"""AgenticX MCP Tool Agent for AgentKit deployment.

Exposes tools as MCP services for other agents to discover and call.

Author: Damon Li
"""

from agenticx.core import Agent
from agenticx.tools import tool

agent = Agent(
    name="tool-agent",
    role="Tool Provider",
    goal="Provide useful tools to other agents via MCP protocol",
    backstory="You are a tool provider agent exposing capabilities via MCP.",
)


@tool
def calculator(expression: str) -> str:
    """Evaluate a mathematical expression.

    Args:
        expression: Math expression to evaluate (e.g., '2 + 3 * 4').

    Returns:
        Result of the calculation.
    """
    try:
        result = eval(expression)  # noqa: S307
        return str(result)
    except Exception as e:
        return f"Error: {e}"


@tool
def get_current_time() -> str:
    """Get the current date and time.

    Returns:
        Current datetime string.
    """
    from datetime import datetime
    return datetime.now().isoformat()
