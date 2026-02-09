#!/usr/bin/env python3
"""Streaming AgenticX Agent for AgentKit deployment.

Author: Damon Li
"""

from agenticx.core import Agent

agent = Agent(
    name="streaming-agent",
    role="AI Assistant",
    goal="Answer user questions with streaming output",
    backstory="You are a helpful AI assistant with real-time streaming.",
)
