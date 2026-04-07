#!/usr/bin/env python3
"""AgenticX MCP Tool Agent for AgentKit deployment.

Exposes tools as MCP services for other agents to discover and call.

Author: Damon Li
"""

import ast
import operator

from agenticx.core import Agent
from agenticx.tools import tool

agent = Agent(
    name="tool-agent",
    role="Tool Provider",
    goal="Provide useful tools to other agents via MCP protocol",
    backstory="You are a tool provider agent exposing capabilities via MCP.",
)

_SAFE_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def _safe_eval_node(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _safe_eval_node(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_OPS:
        return _SAFE_OPS[type(node.op)](
            _safe_eval_node(node.left), _safe_eval_node(node.right)
        )
    if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_OPS:
        return _SAFE_OPS[type(node.op)](_safe_eval_node(node.operand))
    raise ValueError(f"Unsupported expression node: {type(node).__name__}")


def safe_math_eval(expression: str) -> str:
    """Evaluate a mathematical expression safely (no arbitrary code execution).

    Only numeric literals and basic arithmetic operators are allowed.
    """
    try:
        tree = ast.parse(expression.strip(), mode="eval")
        result = _safe_eval_node(tree)
        return str(result)
    except Exception as e:
        return f"Error: {e}"


@tool
def calculator(expression: str) -> str:
    """Evaluate a mathematical expression.

    Args:
        expression: Math expression to evaluate (e.g., '2 + 3 * 4').

    Returns:
        Result of the calculation.
    """
    return safe_math_eval(expression)


@tool
def get_current_time() -> str:
    """Get the current date and time.

    Returns:
        Current datetime string.
    """
    from datetime import datetime
    return datetime.now().isoformat()
