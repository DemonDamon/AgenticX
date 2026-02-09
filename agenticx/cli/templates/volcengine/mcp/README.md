# AgenticX MCP Tool Agent for AgentKit

This template creates an MCP tool service agent deployed via AgentKit MCPApp.

## Quick Start

```bash
# Configure credentials
agx volcengine config --model ep-xxxxx --api-key your-key

# Deploy as MCP service
agx volcengine deploy --module agent --var agent --mode mcp

# Invoke
agx volcengine invoke "What time is it?"
```

## Files

- `agent.py` - Agent and tool definitions
- `wrapper.py` - Generated MCP AgentKit wrapper (auto-generated)
- `agentkit.yaml` - Deployment configuration (auto-generated)
