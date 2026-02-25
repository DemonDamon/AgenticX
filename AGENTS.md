# AGENTS.md

## Cursor Cloud specific instructions

### Overview
AgenticX is a Python multi-agent application development framework (v0.2.10). It is a pure Python library — no frontend build step required. The main application surface is a FastAPI server (`agenticx.server.server.AgentServer`) and a CLI (`agenticx` / `agx`).

### Python & Dependencies
- Requires Python 3.10+. The VM ships with Python 3.12.
- Install for development: `pip install -e ".[dev]"` from the repo root.
- Dev tools installed by `[dev]`: pytest, pytest-asyncio, pytest-cov, black, isort, flake8, mypy, pre-commit.
- `~/.local/bin` must be on `PATH` for CLI tools (`agenticx`, `pytest`, `black`, `flake8`, etc.).

### Running Tests
- Config lives in both `pytest.ini` (asyncio-mode=auto) and `pyproject.toml`. The `pytest.ini` settings take precedence.
- Run smoke/unit tests: `python3 -m pytest tests/ --ignore=tests/integration --ignore=tests/server --ignore=tests/test_smoke_mcp_sampling.py --ignore=tests/test_mem0_memory.py -k "smoke" -v`
- `test_smoke_mcp_sampling.py` requires the optional `mcp` package; `test_mem0_memory.py` requires `mem0ai`. Both can be skipped safely for core development.
- Some tests in `test_m5_agent_core.py` and `test_m9_observability.py` have pre-existing failures (logging `KeyError` on Python 3.12 due to a `message` key conflict in `LogRecord`).
- Integration tests under `tests/integration/` require Docker (Redis, Milvus, Chroma containers).

### Linting
- `black --check agenticx/` — code formatting (many pre-existing style issues).
- `isort --check-only agenticx/` — import sorting.
- `flake8 agenticx/ --max-line-length 88 --extend-ignore E203,W503` — lint.
- `mypy agenticx/` — type checking (strict mode configured in `pyproject.toml`).

### Running the Application
- CLI: `agenticx --help` or `agx --help`.
- FastAPI server: `from agenticx.server.server import AgentServer; server = AgentServer(title='My Server')` then run via uvicorn. The server exposes `/health` and OpenAI-compatible `/v1/models`, `/v1/chat/completions` endpoints.
- LLM-dependent features require at least one provider API key (e.g., `OPENAI_API_KEY`).

### Key Gotchas
- The `@tool` decorator requires parentheses: use `@tool(name='my_tool')`, not `@tool` bare.
- `Workflow` requires `organization_id`. `WorkflowNode` requires `type` and `name` fields.
- `AgentCard` requires `agent_id` and `endpoint` fields (not `url`).
- The Neo4j warning on import (`Neo4j driver not available`) is harmless — it only affects the optional knowledge graph module.
