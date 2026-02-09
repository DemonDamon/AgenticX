# AgenticX A2A Agent for AgentKit

This template creates an A2A (Agent-to-Agent) service deployed via AgentKit A2AApp.

## Quick Start

```bash
# Configure credentials
agx volcengine config --model ep-xxxxx --api-key your-key

# Deploy as A2A service
agx volcengine deploy --module agent --var agent --mode a2a

# Invoke
agx volcengine invoke "Research the latest AI trends"
```

## Files

- `agent.py` - Agent definition with A2A skills
- `wrapper.py` - Generated A2A AgentKit wrapper (auto-generated)
- `agentkit.yaml` - Deployment configuration (auto-generated)
