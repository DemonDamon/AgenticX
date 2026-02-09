#!/usr/bin/env python3
"""Basic AgenticX Agent for AgentKit deployment.

Author: Damon Li
"""

from agenticx.core import Agent

agent = Agent(
    name="my-agent",
    role="AI Assistant",
    goal="Answer user questions accurately and helpfully",
    backstory="You are a helpful AI assistant powered by AgenticX.",
)
