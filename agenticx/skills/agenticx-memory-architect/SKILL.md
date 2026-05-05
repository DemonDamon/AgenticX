---
name: agenticx-memory-architect
description: Guide for setting up and using the AgenticX memory system including Mem0 integration, long-term memory, context management, and memory-enhanced agents. Use when the user wants to add memory to agents, persist conversation history, build memory-aware workflows, or integrate with Mem0 for long-term recall.
metadata:
  author: AgenticX
  version: "0.3.8"
---

# AgenticX Memory Architect

Guide for building agents with persistent memory capabilities.

## Overview

AgenticX integrates with Mem0 for long-term memory, providing agents with the ability to remember past interactions, learn from experience, and maintain context across sessions.

## Installation

```bash
pip install "agenticx[memory]"
# Includes: mem0, chromadb, qdrant-client, redis, milvus
```

## Memory System Components

| Component | Purpose |
|-----------|---------|
| `MemoryManager` | Core memory management interface |
| `Mem0Integration` | Bridge to Mem0's memory engine |
| `ContextMemory` | Short-term, session-scoped memory |
| `LongTermMemory` | Persistent, cross-session memory |

## Basic Memory Usage

### Initialize Memory

```python
from agenticx.memory import MemoryManager

memory = MemoryManager(
    provider="mem0",
    config={
        "llm": {"provider": "openai", "config": {"model": "gpt-4"}},
        "vector_store": {"provider": "chroma"}
    }
)
```

### Store and Retrieve

```python
# Add a memory
memory.add(
    content="User prefers concise reports with bullet points",
    user_id="user-123",
    agent_id="analyst"
)

# Search memories
results = memory.search(
    query="What format does the user prefer?",
    user_id="user-123"
)
for r in results:
    print(f"[{r.score:.2f}] {r.content}")

# Get all memories for a user
all_memories = memory.get_all(user_id="user-123")
```

## Memory-Enhanced Agents

### Attach Memory to an Agent

```python
from agenticx import Agent, AgentExecutor
from agenticx.memory import MemoryManager
from agenticx.llms import OpenAIProvider

memory = MemoryManager(provider="mem0")
agent = Agent(
    id="assistant",
    name="Personal Assistant",
    role="Assistant with memory",
    goal="Help users while remembering their preferences",
    organization_id="default"
)

executor = AgentExecutor(
    agent=agent,
    llm=OpenAIProvider(model="gpt-4"),
    memory=memory
)

# First interaction — learns preference
result = executor.run(task_1)

# Later interaction — recalls preference
result = executor.run(task_2)  # agent remembers context from task_1
```

## Memory Extraction

AgenticX can automatically extract memorable facts from conversations:

```python
from agenticx.core.memory_extraction import MemoryExtractor

extractor = MemoryExtractor(llm=llm)
facts = extractor.extract(conversation_history)
# facts: ["User is a data scientist", "Prefers Python over R", ...]

for fact in facts:
    memory.add(content=fact, user_id="user-123")
```

## Vector Store Backends

| Backend | Config key | Best for |
|---------|-----------|----------|
| ChromaDB | `"chroma"` | Local development, small scale |
| Qdrant | `"qdrant"` | Production, high performance |
| Redis | `"redis"` | Fast access, ephemeral |
| Milvus | `"milvus"` | Large scale, distributed |

```python
# Qdrant example
memory = MemoryManager(
    provider="mem0",
    config={
        "vector_store": {
            "provider": "qdrant",
            "config": {"host": "localhost", "port": 6333}
        }
    }
)
```

## Healthcare Example

```python
# Medical knowledge memory
memory.add(
    content="Patient has Type 2 diabetes, diagnosed 2023",
    user_id="patient-456",
    metadata={"category": "medical_history"}
)

# Query with context
results = memory.search(
    query="What chronic conditions does the patient have?",
    user_id="patient-456"
)
```

## CLI Memory Operations

```bash
# Run the memory example
python examples/memory_example.py

# Healthcare scenario
python examples/mem0_healthcare_example.py
```

## Best Practices

1. **Scope memories** — always associate with `user_id` and/or `agent_id`
2. **Dedup** — check for similar memories before adding
3. **TTL** — set expiration for time-sensitive information
4. **Privacy** — never store PII without consent; use data isolation
5. **Vector store selection** — ChromaDB for dev, Qdrant/Milvus for production
6. **Memory extraction** — automate fact extraction from conversations
7. **Test retrieval** — verify that stored memories are actually retrievable
