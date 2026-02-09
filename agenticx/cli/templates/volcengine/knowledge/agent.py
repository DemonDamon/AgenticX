#!/usr/bin/env python3
"""AgenticX Knowledge Agent for AgentKit deployment.

Agent with VikingDB knowledge base integration for RAG applications.

Author: Damon Li
"""

import os

from agenticx.core import Agent

agent = Agent(
    name="knowledge-agent",
    role="Knowledge Assistant",
    goal="Answer questions using knowledge base content with RAG",
    backstory=(
        "You are a knowledge assistant that retrieves relevant information "
        "from a VikingDB knowledge base to answer user questions accurately."
    ),
)

# Knowledge base collection name (set via environment variable)
COLLECTION_NAME = os.getenv("DATABASE_VIKING_COLLECTION", "my-knowledge-base")
