# browser-use MCP with AgenticX

Use [browser-use](https://github.com/browser-use/browser-use) as an MCP server so Studio / Desktop agents can drive a real browser via **`mcp_connect`** + **`mcp_call`** (MCP tools are described in the system prompt; they are not registered as separate OpenAI `function` entries).

## Prerequisites

- Python 3.11+
- Chromium for Playwright: `uvx browser-use install` (or follow upstream docs)
- `pip install "agenticx[mcp]"` (or your project’s MCP extra)

## 1. Configure `~/.agenticx/mcp.json`

Machi / agx：每次加载 MCP 列表时会保证 **`~/.agenticx/mcp.json` 里存在 `browser-use` 条目**：没有文件则新建；**已有文件但没有 `browser-use` 则合并写入**（不会删掉你在 Cursor 导入的其它 MCP）。在 Machi 里对 **browser-use** 点 **连接** 时，若使用默认 `uvx` 配置，会先自动执行 **`uvx browser-use install`**（需本机已安装 [uv](https://docs.astral.sh/uv/) 且 `uvx` 在 PATH 中）。

Merge or create the file manually if you prefer (AgenticX loads it before `.cursor/mcp.json`). Example:

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

### SOCKS proxy / `socksio` / `httpx[socks]`

If `mcp_call` returns an error like **`Using SOCKS proxy, but the 'socksio' package is not installed`**, your shell (or `agx serve`) is passing **`ALL_PROXY` / `HTTP_PROXY`** with a **socks** URL into the browser-use subprocess. The isolated `uvx` env does not include SOCKS extras by default.

Pick one:

1. **Install SOCKS support into the env that runs browser-use** (e.g. a venv where you `pip install 'browser-use[cli]' 'httpx[socks]'` and point `mcp.json` `command` to that interpreter instead of plain `uvx`), **or**
2. **Stop forcing SOCKS for that MCP only** — in `~/.agenticx/mcp.json` under `browser-use`, add an `env` block that clears proxy variables for the subprocess (only if you do **not** need a proxy to reach the target sites):

```json
"env": {
  "ALL_PROXY": "",
  "all_proxy": "",
  "HTTP_PROXY": "",
  "http_proxy": "",
  "HTTPS_PROXY": "",
  "https_proxy": ""
}
```

Use real tool names from `list_mcps` / discovered tools (e.g. `browser_navigate`, `retry_with_browser_use_agent`). There is no `browse_to` or `list_tools` on the stock browser-use MCP.

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

## 4. How to test (CLI vs AgenticX)

### 4.1 Smoke: browser-use **CLI** only (no AgenticX)

Verifies Chromium + daemon + indexed DOM (see [browser-use CLI](https://github.com/browser-use/browser-use)):

```bash
# One-time
uvx browser-use install

# In a terminal (daemon starts automatically)
browser-use open https://www.bilibili.com
browser-use state
# Optional: browser-use click <index>   # index from state output
browser-use close
```

If `open` / `state` work, the runtime is fine; AgenticX MCP uses the same stack inside the MCP server process.

### 4.2 End-to-end: AgenticX + MCP

1. Start `agx serve` (or Desktop) with valid `~/.agenticx/mcp.json` as in §1.
2. In chat, let the model run **`mcp_connect`** with `name`: `browser-use`.
3. Then **`mcp_call`** with the JSON below (or paste the task in natural language and let the agent fill `mcp_call`).

### 4.3 Example task: 在 B 站给「当贝Dangbei」第一个代表作点赞

You can use this as a **template**; success depends on page structure, login state, and site behavior (验证码、未登录限制等).

**`mcp_call` arguments** (`tool_name` = `retry_with_browser_use_agent`):

```json
{
  "tool_name": "retry_with_browser_use_agent",
  "arguments": {
    "task": "目标：在哔哩哔哩（bilibili.com）上，找到 UP 主「当贝Dangbei」的空间或投稿列表，打开其「第一个代表作」或按时间最早的代表性长视频稿件对应的播放页，在播放器下方对视频点击「点赞」（大拇指）按钮。要求：1) 若未登录导致无法点赞，在结果中明确说明需要用户先登录；2) 每步简要说明当前 URL 与可见元素；3) 若点赞成功，说明点赞按钮状态变化；4) 不要执行评论、投币、分享以外的多余操作。",
    "allowed_domains": ["bilibili.com", ".bilibili.com", "b23.tv"],
    "max_steps": 100,
    "use_vision": true
  }
}
```

**Notes:**

- **`OPENAI_API_KEY`** (or browser-use config for another provider) must be valid; the **inner** agent uses it, not necessarily the same as AgenticX’s chat model.
- Restricting **`allowed_domains`** reduces stray navigation; include `b23.tv` if the site redirects short links.
- **Headed mode** (visible window): configure via [browser-use](https://github.com/browser-use/browser-use) env / config (e.g. non-headless profile) in the MCP server environment in `mcp.json`.
- **Compliance**: Automating third-party sites may be restricted by their terms; use a test account and low frequency.

### 4.4 Regression (no real browser)

From the AgenticX repo:

```bash
pytest tests/test_studio_mcp_call_async.py -q
```

This checks that `mcp_call` does not use nested `asyncio.run` under an active event loop; it does **not** start Chromium.

## References

- Research notes: `research/codedeepresearch/browser-use/browser-use_proposal.md`
- Upstream MCP entry: `uvx browser-use[cli] --mcp`
