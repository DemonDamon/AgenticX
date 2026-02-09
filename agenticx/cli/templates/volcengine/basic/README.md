# AgenticX Basic Agent for AgentKit

This template creates a basic AgenticX agent deployed via AgentKit SimpleApp.

## Quick Start

```bash
# Configure credentials
agx volcengine config --model ep-xxxxx --api-key your-key

# Deploy
agx volcengine deploy --module agent --var agent

# Invoke
agx volcengine invoke "Hello!"
```

## Files

- `agent.py` - Agent definition
- `wrapper.py` - Generated AgentKit wrapper (auto-generated)
- `agentkit.yaml` - Deployment configuration (auto-generated)
