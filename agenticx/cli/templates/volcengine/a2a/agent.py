#!/usr/bin/env python3
"""AgenticX A2A Agent for AgentKit deployment.

Supports agent-to-agent communication via A2A protocol.

Author: Damon Li
"""

from agenticx.core import Agent

agent = Agent(
    name="research-agent",
    role="Research Specialist",
    goal="Conduct deep research on given topics and provide comprehensive reports",
    backstory=(
        "You are a research specialist agent that can collaborate with "
        "other agents via A2A protocol to accomplish complex research tasks."
    ),
)

# A2A skills exposed by this agent
skills = [
    {
        "name": "research",
        "description": "Research a topic and provide a comprehensive report",
    },
    {
        "name": "summarize",
        "description": "Summarize given text or documents",
    },
]
