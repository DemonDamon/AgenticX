# browser-use CLI 能力集成 AgenticX — 技术方案

## 1. 背景与问题定义

**目标**：让 AgenticX 中的智能体（Studio / Desktop / SDK）能稳定使用 [browser-use](https://github.com/browser-use/browser-use) 提供的 **持久浏览器、索引化 DOM 操作、截图/state** 等能力（README 所述 CLI 工作流：`open` → `state` → `click` 等）。

**边界**：

- 优先复用上游实现，不在 AgenticX 内重写 CDP 栈。
- 第一版不要求 UI 内嵌浏览器预览（可后续接 `live_url`/截图）。

**非目标**：

- 替换 AgenticX 的 Meta-Agent / 工具执行器架构。
- 默认启用高风险的 `eval` / 任意 `python` REPL（除非显式策略允许）。

**可验证上游事实**（源码）：

- CLI 入口：`browser_use.skill_cli.main:main`（`pyproject.toml`）。
- 子进程 daemon：`python -m browser_use.skill_cli.daemon`（`main.py` `ensure_daemon`）。
- IPC：JSON 行 + `action`/`params`（`send_command`）。
- 替代集成面：`--mcp` → `browser_use.mcp.server`（`main.py` 早期退出分支）。

---

## 2. 上游关键思想（可验证 + 证据）

1. **冷启动与重活分离**：客户端 stdlib 化快启动，浏览器与 CDP 会话留在 daemon。
2. **会话隔离**：`--session` → 不同 socket/PID（`main.py` session 校验与路径工具）。
3. **配置冲突显式失败**：已运行 daemon 与新的 headed/profile/cdp 不一致时拒绝，避免静默错连（`ensure_daemon` + `ping`）。
4. **机器可读输出**：`--json` 便于上层封装，无需解析人类文本。

---

## 3. 可迁移的最小机制（Principles + Invariants）

**Principles**

- **P1**：集成应落在 AgenticX 的 **工具边界**（`BaseTool` / MCP / Studio 工具表），不侵入 LLM provider。
- **P2**：优先 **稳定接口**（MCP 或 subprocess CLI），避免复制私有 socket 协议除非接受版本锁。
- **P3**：默认 **最小权限**：工具白名单子命令；危险命令单独开关。

**Invariants**

- **I1**：每次 tool 调用须能关联 `session_id`（映射到 `BROWSER_USE_SESSION` 或 AGX 自有 session 字段）。
- **I2**：错误须结构化（至少：success、error message、可选 stderr），进入 `ToolExecutor` 与日志。
- **I3**：与现有 **SSRF/路径** 策略一致：上传路径、URL 打开需走现有 `SafetyLayer` 校验（若适用）。

---

## 4. AgenticX 方案设计

### 4.0 实际调用路径（与「零代码」表述的修正）

- AgenticX **不会**把已连接 MCP 上的工具自动注册为 OpenAI Chat Completions 的 **独立 `functions`**。模型看到的是固定工具集里的 **`mcp_connect`** / **`mcp_call`** / **`mcp_import`**，以及系统提示中由 [`build_mcp_tools_context`](../../../agenticx/cli/studio_mcp.py) 注入的 **MCP 工具名与 JSON Schema 文本**。
- Studio / Desktop 的 `AgentRuntime` 在异步事件循环中执行工具；**`mcp_call` 已实现 `await hub.call_tool`**（[`mcp_call_tool_async`](../../../agenticx/cli/studio_mcp.py)），避免在运行中的 loop 里嵌套 `asyncio.run` 导致失败。
- 高层自然语言浏览器任务优先通过 MCP 工具 **`retry_with_browser_use_agent`**（内层再跑 browser-use 的 `Agent`）；细粒度控制用 **`browser_navigate`**、**`browser_get_state`**、**`browser_click`** 等（见上游 `browser_use/mcp/server.py`）。
- **有头浏览器**：由 browser-use 的 `BrowserProfile` / 环境变量 / 配置文件控制，以满足「看得见浏览器在操作」；AgenticX 侧不强制 headed。
- 配置示例与步骤：[`examples/browser-use-mcp.md`](../../../examples/browser-use-mcp.md)，`~/.agenticx/mcp.json`。

### 4.1 API / 接口草案（SDK 视角）

**方案 A — MCP（推荐）**

- 在 `~/.agenticx/mcp.json`（或合并 `.cursor/mcp.json`）中增加 server，例如：`command` `uvx`，`args` `["browser-use[cli]", "--mcp"]`，`env` 含内层 Agent 所需 **`OPENAI_API_KEY`**（或其它上游支持的 provider 配置），`timeout` 建议 ≥600s。
- 运行时：`mcp_connect` → `mcp_call`，`tool_name` 与路由后的名称一致（多 server 冲突时可能带 `server__` 前缀，以系统提示中的列表为准）。

**方案 B — 显式 `BrowserUseTool`（subprocess）**

```text
browser_use_cli(
  session: str | None,      # 默认 "default" 或与会话绑定
  subcommand: str,          # e.g. "open", "state", "click"
  args: list[str],          # 剩余 CLI 参数
  headed: bool = False,
  profile: str | None = None,
  cdp_url: str | None = None,
  json_output: bool = True
) -> dict
```

实现：组装 `["browser-use", ...]` 或 `sys.executable -m browser_use.skill_cli`，捕获 stdout 解析 JSON。

**方案 C — In-process（可选，重依赖）**

- `pip install browser-use` 后直接使用 `Browser` / `BrowserSession`，由 AgenticX 进程持有生命周期。
- 适合深度定制；与 Machi/Electron 打包体积冲突风险高，建议 **仅 Pro 源码环境** 或可选 extra。

### 4.2 模块划分与数据流

```
User / LLM
  → AgentRuntime / dispatch_tool_async
    → mcp_call → await MCPHub.call_tool → MCPClientV2 (stdio) → browser-use --mcp
    → （可选）方案 B：专用工具 → subprocess(browser-use --json ...)
  → Tool result → chat_history / observability
```

### 4.3 关键策略

- **Session 映射**：AGX `session_id` 哈希缩短为 `bu_<8hex>` 作为 `BROWSER_USE_SESSION`，减少多开用户冲突。
- **守护进程生命周期**：工具层不负责全局 kill；提供显式 `browser_use_close` 或在 AGX session 销毁钩子发 `close`。
- **Desktop**：Electron 侧若已有 CDP 调试端口，可传 `--cdp-url` 复用用户 Chrome（与 browser-use 一致）。

### 4.4 错误处理与可观测性

- 记录：subcommand、session、耗时、是否 daemon 启动、退出码。
- Metrics：成功率、平均延迟、Chromium 启动失败次数。

---

## 5. 集成计划（分阶段）

| 阶段 | 内容 | 产出 |
|------|------|------|
| **PoC** | `mcp_call` 异步修复 + `examples/browser-use-mcp.md` + README 链接 + Studio 系统提示浏览器指引 | 可复现 MCP 路径 |
| **MVP** | 方案 B 单一 `BrowserUseCliTool`（可选）+ 白名单子命令 | 合并可选依赖 `browser-use` |
| **稳定化** | Session 生命周期挂钩、Desktop 配置 GUI、危险命令策略 | E2E 用例、ADR |

---

## 6. 评测计划（摘要，详见 `browser-use_eval_plan.md`）

- **任务集**：打开指定 URL → `state` 含标题 → `click` 索引 → 断言 URL 变化或文本出现。
- **指标**：任务成功率、平均步数、P95 延迟、daemon 残留进程数（应为 0）。
- **门禁**：CI 可选 job（仅当安装 Chromium）或 nightly。

---

## 7. 风险与回滚

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 上游 CLI 协议变更 | 优先 MCP；subprocess 锁版本 pin | 移除工具注册项 |
| Chromium 体积/失败 | 文档 `browser-use install`；optional extra | 默认关闭功能开关 |
| 安全面扩大 | 白名单 + SafetyLayer | 配置 `enabled: false` |

---

## 8. 后续工作（社区跟进）

- 跟踪 `browser-use` Releases 与 `skill_cli` 破坏性变更。
- Issue：多 session 默认端口/套接字冲突类问题（Windows TCP）。
- 若官方提供 **稳定 JSON-RPC daemon API** 文档，可评估从 subprocess 迁 in-proc 客户端。

---

## 9. 建议的下一步（模块级）

1. **已完成（PoC）**：`examples/browser-use-mcp.md`；`mcp_call_tool_async` + `dispatch_tool_async` 中的 `mcp_call`；`_build_agent_system_prompt` 浏览器指引；`tests/test_studio_mcp_call_async.py`。
2. **后做**：Desktop 设置页 MCP 模板或 browser-use 安装检测；可选 `BrowserUseCliTool`（方案 B）。
3. **ADR**：在 `.cursor/plans/` 或 `docs/adr/` 记录「为何选 MCP 优先于 socket 复制」与「危险子命令默认关闭」。
