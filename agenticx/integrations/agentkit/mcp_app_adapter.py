#!/usr/bin/env python3
"""AgentKit MCP App Adapter for AgenticX.

Adapts AgenticX tools and agents to be exposed as MCP services through
AgentKit's AgentkitMCPApp framework.

Author: Damon Li
"""

import logging
import inspect
from typing import Any, Dict, List, Optional, Callable
from string import Template

logger = logging.getLogger(__name__)


class AgenticXMCPAppAdapter:
    """Adapter to expose AgenticX tools as AgentKit MCP services.

    Converts AgenticX BaseTool instances into functions that can be
    registered with AgentkitMCPApp's @app.tool decorator, and wraps
    entire agents as MCP tools via @app.agent_as_a_tool.

    Example:
        >>> from agenticx.tools import FunctionTool
        >>> adapter = AgenticXMCPAppAdapter()
        >>> adapter.register_tool(my_tool)
        >>> adapter.register_agent_as_tool(my_agent, my_llm)
        >>> wrapper_code = adapter.generate_mcp_wrapper(
        ...     agent_module="my_agent_module",
        ...     agent_var="my_agent",
        ...     tool_vars=["tool1", "tool2"],
        ... )
    """

    def __init__(self) -> None:
        """Initialize the MCP app adapter."""
        self._tools: List[Dict[str, Any]] = []
        self._agent_tools: List[Dict[str, Any]] = []

    def register_tool(self, tool: Any) -> None:
        """Register an AgenticX BaseTool for MCP exposure.

        Extracts the tool's name, description, and parameter schema
        for MCP registration.

        Args:
            tool: AgenticX BaseTool instance.
        """
        tool_info = {
            "name": getattr(tool, "name", str(tool)),
            "description": getattr(tool, "description", ""),
            "args_schema": None,
        }

        # Extract args_schema if available
        if hasattr(tool, "args_schema") and tool.args_schema:
            try:
                tool_info["args_schema"] = tool.args_schema.model_json_schema()
            except Exception:
                pass

        self._tools.append(tool_info)
        logger.info(f"Registered MCP tool: {tool_info['name']}")

    def register_agent_as_tool(
        self,
        agent: Any,
        llm_provider: Any = None,
        description: Optional[str] = None,
    ) -> None:
        """Register an AgenticX Agent as an MCP tool.

        The agent will be exposed as a single tool that accepts a prompt
        and returns the agent's response.

        Args:
            agent: AgenticX Agent instance.
            llm_provider: LLM provider for the agent.
            description: Optional tool description override.
        """
        agent_tool_info = {
            "name": getattr(agent, "name", "agent"),
            "description": description or getattr(
                agent, "goal", "AgenticX Agent"
            ),
            "agent_role": getattr(agent, "role", "assistant"),
        }
        self._agent_tools.append(agent_tool_info)
        logger.info(f"Registered agent as MCP tool: {agent_tool_info['name']}")

    def get_registered_tools(self) -> List[Dict[str, Any]]:
        """Get all registered tools.

        Returns:
            List of tool info dictionaries.
        """
        return self._tools + self._agent_tools

    def generate_mcp_wrapper(
        self,
        agent_module: str,
        agent_var: str,
        tool_vars: Optional[List[str]] = None,
    ) -> str:
        """Generate a standalone MCP wrapper file for AgentKit deployment.

        Creates a Python file that uses AgentkitMCPApp to expose AgenticX
        tools as MCP services.

        Args:
            agent_module: Python module path for the agent.
            agent_var: Variable name of the agent.
            tool_vars: List of tool variable names to import and register.

        Returns:
            Generated wrapper file content as string.
        """
        tool_imports = ""
        tool_registrations = ""

        if tool_vars:
            tool_imports = (
                f"from {agent_module} import "
                + ", ".join(tool_vars)
            )
            for tv in tool_vars:
                tool_registrations += f"""
@app.tool
def {tv}_mcp(**kwargs):
    \"\"\"MCP wrapper for {tv}.\"\"\"
    return {tv}.run(**kwargs)
"""

        template = Template(WRAPPER_TEMPLATE_MCP)
        return template.substitute(
            agent_module_name=agent_module,
            agent_var_name=agent_var,
            tool_imports=tool_imports,
            tool_registrations=tool_registrations,
        )


WRAPPER_TEMPLATE_MCP = """#!/usr/bin/env python3
'''
AgentKit MCP Wrapper for AgenticX Agent

Exposes AgenticX tools as MCP services through AgentkitMCPApp.

Author: Damon Li
'''
import os
import logging

from $agent_module_name import $agent_var_name
$tool_imports

from agentkit.apps import AgentkitMCPApp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


app = AgentkitMCPApp()

$tool_registrations

@app.agent_as_a_tool
def agent_tool(prompt: str) -> str:
    \"\"\"Execute the AgenticX agent as an MCP tool.\"\"\"
    from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper
    wrapper = AgenticXAgentWrapper(agent=$agent_var_name)
    return wrapper.handle_invoke(
        payload={"prompt": prompt},
        headers={"user_id": "mcp", "session_id": "mcp-session"},
    )


if __name__ == "__main__":
    app.run()
"""
