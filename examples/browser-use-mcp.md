# browser-use MCP with AgenticX

Use [browser-use](https://github.com/browser-use/browser-use) as an MCP server so Studio / Desktop agents can drive a real browser via **`mcp_connect`** + **`mcp_call`** (MCP tools are described in the system prompt; they are not registered as separate OpenAI `function` entries).

## Prerequisites

- Python 3.11+
- Chromium for Playwright: `uvx browser-use install` (or follow upstream docs)
- `pip install "agenticx[mcp]"` (or your project’s MCP extra)

## 1. Configure `~/.agenticx/mcp.json`

Merge or create the file (AgenticX loads it before `.cursor/mcp.json`). Example:

```json
{
  "browser-use": {
    "command": "uvx",
    "args": ["browser-use[cli]", "--mcp"],
    "env": {
      "OPENAI_API_KEY": "sk-..."
    },
    "timeout": 600.0
  }
}
```

Notes:

- **`timeout`**: `retry_with_browser_use_agent` can run for a long time; use a large value (e.g. `600`).
- **Inner LLM**: The MCP tool `retry_with_browser_use_agent` starts browser-use’s own agent, which by default uses **`OPENAI_API_KEY`** (see upstream `browser_use/mcp/server.py`). For other providers, configure browser-use via its config file or env as in [browser-use docs](https://github.com/browser-use/browser-use).
- **Headed browser**: Set browser-use profile / env so Chromium runs non-headless if you want a visible window (see upstream `BrowserProfile` / CLI `--headed` patterns).

## 2. Workflow in chat

1. Ensure the server appears in config (`mcp_import` from another `mcp.json` if needed).
2. Call **`mcp_connect`** with `name` = `browser-use` (the key in `mcp.json`).
3. Call **`mcp_call`** with:
   - **`tool_name`**: e.g. `retry_with_browser_use_agent` for a one-shot natural-language task, or `browser_navigate` / `browser_get_state` / `browser_click` for step-by-step control.
   - **`arguments`**: object matching the tool schema (e.g. `task`, `allowed_domains`, `max_steps` for the agent tool).

Example arguments for a high-level task:

```json
{
  "tool_name": "retry_with_browser_use_agent",
  "arguments": {
    "task": "Open bilibili.com, find the first video from channel X, and click like. Describe each step.",
    "allowed_domains": ["bilibili.com", ".bilibili.com"],
    "max_steps": 80,
    "use_vision": true
  }
}
```

## 3. Auto-connect (optional)

If your global AgenticX config lists this server for auto-connect, it may connect on session start; otherwise use `mcp_connect` explicitly.

## References

- Research notes: `research/codedeepresearch/browser-use/browser-use_proposal.md`
- Upstream MCP entry: `uvx browser-use[cli] --mcp`
