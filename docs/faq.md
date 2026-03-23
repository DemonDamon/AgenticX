# FAQ

## General

### What is AgenticX?

AgenticX is a unified, production-ready Python framework for building multi-agent AI applications. It provides everything from a single-agent execution engine to complex multi-agent orchestration, memory systems, tool integration, and a full Studio UI.

### How is AgenticX different from LangChain or CrewAI?

AgenticX is designed for production from day one:
- **Unified**: One framework covers agents, tools, memory, orchestration, protocols (A2A/MCP), observability, and security
- **Studio**: A full web UI and Desktop app for managing agents, sessions, and group chats
- **Enterprise-ready**: Security layer, sandbox execution, audit logging, and session isolation built in
- **Multi-agent native**: Avatar system, group chat, Meta-Agent CEO pattern, and team management out of the box

### Is AgenticX open source?

Yes. AgenticX is licensed under [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0).

---

## Installation

### What Python version is required?

Python 3.10 or higher.

### How do I install optional features?

```bash
pip install "agenticx[all]"    # Everything
pip install "agenticx[vector]" # Vector store support
pip install "agenticx[doc]"    # Document parsing (PDF, Word, etc.)
```

---

## LLM Providers

### Which LLM providers are supported?

15+ providers including OpenAI, Anthropic, Ollama (local), Gemini, Kimi/Moonshot, MiniMax, Ark/VolcEngine, Zhipu, Qianfan, and Bailian/Dashscope.

### Can I use local models?

Yes. Use the `OllamaProvider` to connect to locally running models via [Ollama](https://ollama.ai):

```python
from agenticx.llms import OllamaProvider
llm = OllamaProvider(model="llama3.2", base_url="http://localhost:11434")
```

### Does MiniMax support image inputs?

No. All `minimax-m2*` models do not support image or audio inputs. The framework will warn you if you try to send images to these models.

---

## Tools & MCP

### What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io) is an open standard for connecting AI agents to tools and data sources. AgenticX includes an MCP Hub that can connect to multiple MCP servers simultaneously.

### Can I use tools from other frameworks?

Yes. AgenticX can import tools from LangChain, use OpenAPI specs to auto-generate toolsets, or call any HTTP endpoint via Remote Tools.

---

## Memory

### Where is memory stored?

By default, memory is stored in SQLite at `~/.agenticx/workspace/`. You can configure Redis or PostgreSQL for production deployments.

### Does memory persist across restarts?

Yes. All memory backends (SQLite, Redis, PostgreSQL) persist data between sessions.

---

## Studio & Desktop

### How do I start the Studio UI?

```bash
agx serve --port 8000
# Open http://localhost:8000
```

### What is the Desktop app?

The Machi Desktop app is an Electron-based application that wraps the Studio UI with native OS features like system tray, notifications, and multi-window support. It supports session restoration after restart.

---

## Contributing

### How can I contribute?

See [CONTRIBUTING.md](https://github.com/DemonDamon/AgenticX/blob/main/CONTRIBUTING.md) on GitHub.

### How do I report a bug?

Open an issue on [GitHub Issues](https://github.com/DemonDamon/AgenticX/issues).
