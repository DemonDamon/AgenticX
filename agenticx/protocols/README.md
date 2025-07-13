# AgenticX Protocols Module (M8)

The `agenticx.protocols` module implements the Agent-to-Agent (A2A) communication protocol, inspired by Google's A2A protocol, enabling structured collaboration between AgenticX agents.

## Overview

This module provides a complete implementation of the A2A protocol, allowing agents to:
- Discover each other's capabilities through standardized service discovery
- Create and execute collaboration tasks
- Communicate through HTTP-based APIs
- Wrap remote agent skills as local tools for seamless integration

## Key Components

### Data Models
- **`AgentCard`**: Agent's digital business card published via `/.well-known/agent.json`
- **`Skill`**: Standardized description of agent capabilities
- **`CollaborationTask`**: Basic unit of agent-to-agent collaboration
- **`TaskCreationRequest`**: Request model for creating new tasks
- **`TaskStatusResponse`**: Response model for task status queries

### Storage
- **`BaseTaskStore`**: Abstract interface for task persistence
- **`InMemoryTaskStore`**: Default in-memory implementation for development/testing

### Server Components
- **`A2AWebServiceWrapper`**: Wraps an `AgentExecutor` into A2A-compliant FastAPI service

### Client Components
- **`A2AClient`**: Client for communicating with remote A2A agents
- **`A2ASkillTool`**: Wraps remote agent skills as local tools
- **`A2ASkillToolFactory`**: Factory for creating skill tools

## Quick Start

### 1. Creating an A2A Service

```python
from agenticx.protocols import A2AWebServiceWrapper, InMemoryTaskStore
from agenticx.core.agent_executor import AgentExecutor
from agenticx.llms.litellm_provider import LiteLLMProvider
from agenticx.tools.base import BaseTool

# Create your tools
class MyTool(BaseTool):
    name = "my_tool"
    description = "A sample tool"
    
    async def arun(self, input_text: str) -> str:
        return f"Processed: {input_text}"

# Create agent executor
llm_provider = LiteLLMProvider(model="gpt-3.5-turbo")
agent_executor = AgentExecutor(
    llm_provider=llm_provider,
    tools=[MyTool()]
)

# Create A2A service
task_store = InMemoryTaskStore()
service = A2AWebServiceWrapper(
    agent_executor=agent_executor,
    task_store=task_store,
    agent_id="my_agent",
    agent_name="My Agent",
    agent_description="A sample agent",
    base_url="http://localhost:8000"
)

# Start the service
await service.start_server(port=8000)
```

### 2. Discovering and Using Remote Agents

```python
from agenticx.protocols import A2AClient, A2ASkillTool

# Discover remote agent
client = await A2AClient.from_endpoint("http://localhost:8000")
print(f"Discovered agent: {client.target_agent_card.name}")

# Create tools for remote skills
tools = {}
for skill in client.target_agent_card.skills:
    tool = A2ASkillTool(
        client=client,
        skill=skill,
        issuer_agent_id="coordinator_agent"
    )
    tools[tool.name] = tool

# Use remote tool
result = await tools["My Agent/my_tool"].arun(input_text="Hello World")
print(f"Result: {result}")
```

### 3. Using the Factory Pattern

```python
from agenticx.protocols import A2ASkillToolFactory

# Create all tools for a remote agent
tools = await A2ASkillToolFactory.create_tools_from_agent(
    agent_endpoint="http://localhost:8000",
    issuer_agent_id="coordinator_agent"
)

# Use the tools
for tool_name, tool in tools.items():
    print(f"Available tool: {tool_name}")
```

## Service Discovery

Agents automatically expose their capabilities through the standard endpoint:

```
GET /.well-known/agent.json
```

This returns an `AgentCard` with the agent's metadata and available skills.

## Task Lifecycle

1. **Creation**: Client creates a `CollaborationTask` via `POST /tasks`
2. **Execution**: Server executes the task asynchronously
3. **Polling**: Client polls task status via `GET /tasks/{task_id}`
4. **Completion**: Task completes with result or error

## Error Handling

The module provides comprehensive error handling:
- `TaskError`: Base exception for task-related errors
- `TaskNotFoundError`: Task doesn't exist
- `TaskAlreadyExistsError`: Duplicate task creation
- `A2AClientError`: Base client error
- `A2AConnectionError`: Connection failures
- `A2ATaskError`: Task execution failures

## Production Considerations

### Task Storage
Replace `InMemoryTaskStore` with persistent storage for production:

```python
# Example Redis-based store (implementation not included)
class RedisTaskStore(BaseTaskStore):
    def __init__(self, redis_url: str):
        self.redis = redis.from_url(redis_url)
    
    async def create_task(self, task: CollaborationTask) -> None:
        # Store in Redis
        pass
```

### Security
- Implement authentication/authorization
- Use HTTPS for production deployments
- Validate all inputs and sanitize outputs

### Monitoring
- Add logging and metrics
- Monitor task execution times
- Track success/failure rates

## Testing

Run the test suite:

```bash
python -m pytest tests/test_m8_protocols.py -v
```

## Example

See `examples/m8_a2a_demo.py` for a complete working example demonstrating:
- Calculator agent providing mathematical operations
- Coordinator agent using the calculator through A2A protocol
- Service discovery and remote tool invocation

## Architecture

The M8 module implements a clean separation of concerns:

```
┌─────────────────┐    ┌─────────────────┐
│   Agent A       │    │   Agent B       │
│                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │A2ASkillTool │ │    │ │A2AWebService│ │
│ │             │ │    │ │Wrapper      │ │
│ └─────────────┘ │    │ └─────────────┘ │
│        │        │    │        │        │
│ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │  A2AClient  │ │    │ │ TaskStore   │ │
│ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘
         │                       │
         └───────── HTTP ────────┘
```

This architecture ensures loose coupling while maintaining strong contracts through the A2A protocol specification. 