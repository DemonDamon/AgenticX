# AgenticX Knowledge Agent for AgentKit

This template creates a RAG-enabled agent with VikingDB knowledge base integration.

## Quick Start

```bash
# Set knowledge base collection
export DATABASE_VIKING_COLLECTION=my-knowledge-base

# Configure credentials
agx volcengine config --model ep-xxxxx --api-key your-key

# Deploy
agx volcengine deploy --module agent --var agent

# Invoke
agx volcengine invoke "What products do you offer?"
```

## Files

- `agent.py` - Agent definition with knowledge base config
- `wrapper.py` - Generated AgentKit wrapper (auto-generated)
- `agentkit.yaml` - Deployment configuration (auto-generated)
