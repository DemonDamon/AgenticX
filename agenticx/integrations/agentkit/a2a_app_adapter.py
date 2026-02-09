#!/usr/bin/env python3
"""AgentKit A2A App Adapter for AgenticX.

Adapts AgenticX A2A protocol implementation to work with AgentKit's
AgentkitA2aApp framework for agent-to-agent communication.

Author: Damon Li
"""

import logging
from typing import Any, Dict, List, Optional
from string import Template

logger = logging.getLogger(__name__)


class AgenticXA2AAppAdapter:
    """Adapter to deploy AgenticX A2A agents on AgentKit platform.

    Converts AgenticX's A2AWebServiceWrapper-style agents into
    AgentkitA2aApp-compatible agent executors, bridging the two
    A2A protocol implementations.

    Example:
        >>> adapter = AgenticXA2AAppAdapter(
        ...     agent_name="research-agent",
        ...     agent_description="Performs deep research tasks",
        ...     skills=[{"name": "research", "description": "Research a topic"}],
        ... )
        >>> wrapper_code = adapter.generate_a2a_wrapper(
        ...     agent_module="my_research_agent",
        ...     agent_var="agent",
        ... )
    """

    def __init__(
        self,
        agent_name: str = "agenticx-agent",
        agent_description: str = "AgenticX Agent",
        skills: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """Initialize the A2A app adapter.

        Args:
            agent_name: Name of the agent for A2A discovery.
            agent_description: Description of agent capabilities.
            skills: List of skill definitions with name and description.
        """
        self.agent_name = agent_name
        self.agent_description = agent_description
        self.skills = skills or []

    def add_skill(
        self, name: str, description: str, parameters_schema: Optional[Dict] = None
    ) -> None:
        """Add a skill to the agent's capability list.

        Args:
            name: Skill name.
            description: Skill description.
            parameters_schema: Optional JSON Schema for skill parameters.
        """
        self.skills.append({
            "name": name,
            "description": description,
            "parameters_schema": parameters_schema or {},
        })

    def generate_a2a_wrapper(
        self,
        agent_module: str,
        agent_var: str,
    ) -> str:
        """Generate a standalone A2A wrapper for AgentKit deployment.

        Creates a Python file that wraps an AgenticX agent as an
        AgentkitA2aApp agent executor.

        Args:
            agent_module: Python module path for the agent.
            agent_var: Variable name of the agent.

        Returns:
            Generated wrapper file content as string.
        """
        # Build skills list string
        skills_str = "[\n"
        for skill in self.skills:
            skills_str += (
                f'        {{"name": "{skill["name"]}", '
                f'"description": "{skill["description"]}"}},\n'
            )
        skills_str += "    ]"

        template = Template(WRAPPER_TEMPLATE_A2A)
        return template.substitute(
            agent_module_name=agent_module,
            agent_var_name=agent_var,
            agent_name=self.agent_name,
            agent_description=self.agent_description,
            skills_list=skills_str,
        )


WRAPPER_TEMPLATE_A2A = """#!/usr/bin/env python3
'''
AgentKit A2A Wrapper for AgenticX Agent

Exposes AgenticX agent as an A2A-compatible service through AgentkitA2aApp.

Author: Damon Li
'''
import os
import logging
import asyncio

from $agent_module_name import $agent_var_name

from agentkit.apps import AgentkitA2aApp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


# Auto-detect Volcengine Ark model
_ark_llm = None
if os.getenv("MODEL_AGENT_NAME"):
    try:
        from agenticx.llms import ArkLLMProvider
        _ark_llm = ArkLLMProvider(
            endpoint_id=os.getenv("MODEL_AGENT_NAME"),
            api_key=os.getenv("MODEL_AGENT_API_KEY"),
        )
        if not getattr($agent_var_name, 'llm', None):
            $agent_var_name.llm = _ark_llm
    except Exception as e:
        logger.warning(f"Failed to auto-inject ArkLLMProvider: {e}")


app = AgentkitA2aApp(
    name="$agent_name",
    description="$agent_description",
    skills=$skills_list,
)


class AgenticXExecutor:
    \"\"\"A2A agent executor wrapping AgenticX agent.\"\"\"

    async def execute(self, request_context, event_queue):
        \"\"\"Execute the agent with A2A protocol.\"\"\"
        from agenticx.deploy.components.volcengine.wrapper import AgenticXAgentWrapper

        prompt = request_context.get("prompt", "")
        wrapper = AgenticXAgentWrapper(
            agent=$agent_var_name,
            llm_provider=_ark_llm,
        )

        result = wrapper.handle_invoke(
            payload={"prompt": prompt},
            headers={
                "user_id": request_context.get("user_id", "a2a"),
                "session_id": request_context.get("session_id", "a2a-session"),
            },
        )

        await event_queue.put({
            "type": "result",
            "content": result,
        })


@app.agent_executor
def get_executor():
    \"\"\"Register the AgenticX agent executor.\"\"\"
    return AgenticXExecutor()


@app.ping
def ping() -> str:
    \"\"\"Health check.\"\"\"
    return "pong!"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
"""
