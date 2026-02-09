#!/usr/bin/env python3
"""VeADK Bridge for AgenticX.

Provides bidirectional conversion between AgenticX Agent and veadk Agent,
enabling AgenticX agents to run through veadk's Runner for enhanced
compatibility with Volcengine AgentKit platform.

Author: Damon Li
"""

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class VeADKBridge:
    """Bridge between AgenticX Agent and veadk Agent+Runner.

    Converts AgenticX agents to veadk format and vice versa, enabling
    seamless integration with veadk's execution model while preserving
    AgenticX agent capabilities.

    Example:
        >>> bridge = VeADKBridge()
        >>> veadk_agent = bridge.to_veadk_agent(agenticx_agent)
        >>> runner = veadk.Runner(agent=veadk_agent)
        >>> response = await runner.run(messages="Hello!")
    """

    def __init__(self) -> None:
        """Initialize the VeADK bridge."""
        self._veadk_available = False
        try:
            import veadk  # noqa: F401

            self._veadk_available = True
        except ImportError:
            logger.warning(
                "veadk not installed. VeADK bridge features unavailable. "
                "Install with: pip install veadk"
            )

    def to_veadk_agent(
        self, agenticx_agent: Any, llm_provider: Optional[Any] = None
    ) -> Any:
        """Convert AgenticX Agent to veadk Agent.

        Args:
            agenticx_agent: AgenticX Agent instance.
            llm_provider: Optional LLM provider (if not set on agent).

        Returns:
            veadk Agent instance.

        Raises:
            ImportError: If veadk is not installed.
        """
        if not self._veadk_available:
            raise ImportError(
                "veadk not installed. Install with: pip install veadk"
            )

        from veadk import Agent

        # Extract agent properties
        name = getattr(agenticx_agent, "name", "agenticx-agent")
        role = getattr(agenticx_agent, "role", "assistant")
        goal = getattr(agenticx_agent, "goal", "Help users")
        backstory = getattr(agenticx_agent, "backstory", "")

        # Get LLM provider
        llm = llm_provider or getattr(agenticx_agent, "llm", None)

        # Build instruction from role, goal, backstory
        instruction_parts = []
        if role:
            instruction_parts.append(f"Role: {role}")
        if goal:
            instruction_parts.append(f"Goal: {goal}")
        if backstory:
            instruction_parts.append(f"Backstory: {backstory}")

        instruction = "\n".join(instruction_parts)

        # Create veadk agent
        veadk_agent = Agent(
            name=name,
            instruction=instruction,
            model_name=self._get_model_name(llm),
            model_api_key=self._get_api_key(llm),
        )

        # Copy tools if available
        if hasattr(agenticx_agent, "tools") and agenticx_agent.tools:
            # Note: veadk tool integration would require additional mapping
            logger.debug(f"Agent has {len(agenticx_agent.tools)} tools")

        return veadk_agent

    def from_veadk_agent(self, veadk_agent: Any) -> Any:
        """Convert veadk Agent to AgenticX Agent.

        Args:
            veadk_agent: veadk Agent instance.

        Returns:
            AgenticX Agent instance.
        """
        from agenticx.core import Agent

        # Extract veadk agent properties
        name = getattr(veadk_agent, "name", "veadk-agent")
        instruction = getattr(veadk_agent, "instruction", "")

        # Parse instruction into role/goal/backstory
        role = ""
        goal = ""
        backstory = ""

        if instruction:
            lines = instruction.split("\n")
            for line in lines:
                if line.startswith("Role:"):
                    role = line.replace("Role:", "").strip()
                elif line.startswith("Goal:"):
                    goal = line.replace("Goal:", "").strip()
                elif line.startswith("Backstory:"):
                    backstory = line.replace("Backstory:", "").strip()

        # Create AgenticX agent
        agenticx_agent = Agent(
            name=name,
            role=role or "assistant",
            goal=goal or "Help users",
            backstory=backstory,
        )

        return agenticx_agent

    async def run_with_veadk(
        self,
        agent: Any,
        messages: str,
        llm_provider: Optional[Any] = None,
        **kwargs: Any,
    ) -> str:
        """Run AgenticX Agent through veadk Runner.

        Args:
            agent: AgenticX Agent instance.
            messages: Input message string.
            llm_provider: Optional LLM provider override.
            **kwargs: Additional arguments for veadk Runner.

        Returns:
            Response string from the agent.
        """
        if not self._veadk_available:
            raise ImportError(
                "veadk not installed. Install with: pip install veadk"
            )

        from veadk import Runner

        veadk_agent = self.to_veadk_agent(agent, llm_provider=llm_provider)
        runner = Runner(agent=veadk_agent, **kwargs)

        import asyncio

        response = await runner.run(messages=messages)
        return response

    def _get_model_name(self, llm_provider: Optional[Any]) -> str:
        """Extract model name from LLM provider.

        Args:
            llm_provider: LLM provider instance.

        Returns:
            Model name string.
        """
        if not llm_provider:
            return "doubao-seed-1-6"

        # Try to get model from provider
        if hasattr(llm_provider, "model"):
            return llm_provider.model
        if hasattr(llm_provider, "endpoint_id"):
            return llm_provider.endpoint_id or llm_provider.model

        return "doubao-seed-1-6"

    def _get_api_key(self, llm_provider: Optional[Any]) -> Optional[str]:
        """Extract API key from LLM provider.

        Args:
            llm_provider: LLM provider instance.

        Returns:
            API key string or None.
        """
        if not llm_provider:
            import os

            return os.getenv("MODEL_AGENT_API_KEY")

        if hasattr(llm_provider, "api_key"):
            return llm_provider.api_key

        return None
