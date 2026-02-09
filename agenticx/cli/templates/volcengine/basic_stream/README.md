# AgenticX Streaming Agent for AgentKit

This template creates a streaming AgenticX agent deployed via AgentKit SimpleApp.

## Quick Start

```bash
# Configure credentials
agx volcengine config --model ep-xxxxx --api-key your-key

# Deploy with streaming enabled
agx volcengine deploy --module agent --var agent --stream

# Invoke
agx volcengine invoke "Hello!"
```

## Files

- `agent.py` - Agent definition
- `wrapper.py` - Generated streaming AgentKit wrapper (auto-generated)
- `agentkit.yaml` - Deployment configuration (auto-generated)
