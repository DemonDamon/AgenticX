# Architecture

## Overview

AgenticX is organized into **5 tiers**, from user-facing interfaces down to platform services.

```
┌─────────────────────────────────────────────────────┐
│                  User Interface                      │
│         Desktop App │ CLI (agx) │ SDK               │
├─────────────────────────────────────────────────────┤
│                 Studio Runtime                       │
│   Session Manager │ Meta-Agent │ Team Manager        │
│         Avatar Registry │ Group Chat                 │
├─────────────────────────────────────────────────────┤
│                 Core Framework                       │
│  Orchestration │ Execution │ Agent │ Memory          │
│       Tools │ LLM Providers │ Hooks                  │
├─────────────────────────────────────────────────────┤
│               Platform Services                      │
│  Observability │ Protocols (A2A/MCP) │ Security      │
│              Storage Layer                           │
├─────────────────────────────────────────────────────┤
│               Domain Extensions                      │
│    GUI Agent │ Knowledge & GraphRAG │ AgentKit        │
└─────────────────────────────────────────────────────┘
```

![AgenticX System Architecture](../assets/architecture.png)

---

## Tier 1: User Interface

### Desktop App
Electron + React + Zustand + Vite. Supports Pro mode (multi-pane) and Lite mode (single-pane). Features include command palette, settings panel, avatar sidebar, sub-agent panel, session history, and workspace panel.

### CLI (`agx`)
Full-featured command-line tool covering: serve, studio, loop, run, project, deploy, codegen, docs, skills, hooks, debug, scaffold, config management.

See [CLI Reference →](../cli.md)

### SDK
Python SDK for embedding AgenticX into your own applications.

---

## Tier 2: Studio Runtime

### Session Manager
Manages user sessions, chat history persistence (`messages.json`), write locks, and in-memory state. Supports cross-session avatar status queries.

### Meta-Agent
The CEO dispatcher. Dynamically orchestrates sub-agents, maintains active agent snapshots, and handles memory recall injection per turn. Built via `agenticx/runtime/prompts/meta_agent.py`.

### Team Manager (`AgentTeamManager`)
Controls concurrent agent execution, archived snapshots (`_archived_agents`), `owner_session_id` session isolation, `avatar_id` binding, and global registry lookup.

### Avatar & Group Chat
- **Avatar Registry**: CRUD operations for persistent agent identities
- **Group Chat**: Multiple routing strategies — user-directed (`@mention`), meta-routed, round-robin
- **Group Router**: Handles `@mention` parsing (full name / slug ID), intelligent routing to named members

---

## Tier 3: Core Framework

### Agent Execution Engine
Based on 12-Factor Agents methodology. The think-act loop processes tool calls, handles context overflow, and performs self-repair. Tool call sequences are validated to prevent provider 400 errors.

### Orchestration Engine
Graph-based workflow with conditional routing and parallel execution. The Flow system provides decorator-based pipeline definition.

### Tool System
- Function decorators (`@tool`)
- MCP Hub (multi-server aggregation)
- Remote Tools v2
- OpenAPI toolset
- Sandbox tools
- Skill bundles

### Memory System
Hierarchical: core → episodic → semantic. Integrates with Mem0 for long-term persistence. Supports memory decay, hybrid search, and compaction/flush.

### LLM Providers
Unified provider interface for 15+ LLMs with response caching, failover routing, and transcript sanitization.

---

## Tier 4: Platform Services

### Observability
Callback system, real-time metrics, Prometheus/OpenTelemetry integration, trajectory analysis, span tree, WebSocket streaming.

### Protocols
- **A2A**: Inter-agent communication (client / server / AgentCard / skill-as-tool)
- **MCP**: Model Context Protocol for tool and resource access

### Security
Leak detection, injection detector, policy engine, audit logging, sandbox (Docker / Microsandbox / Subprocess).

### Storage
- **KV**: SQLite, Redis, PostgreSQL, MongoDB, InMemory
- **Vector**: Milvus, Qdrant, Chroma, Faiss, PgVector, Pinecone, Weaviate
- **Graph**: Neo4j, Nebula
- **Object**: S3, GCS, Azure

---

## Tier 5: Domain Extensions

### GUI Agent
Desktop automation framework with A/B/C result classification using heuristic and VLM reflection modes.

### Knowledge & GraphRAG
Document processing pipeline → chunkers / readers / extractors → graph builders (GraphRAG) → retrievers (vector / BM25 / graph / hybrid) → reranker.

### AgentKit Integration
Pluggable integration layer for external agent frameworks.
