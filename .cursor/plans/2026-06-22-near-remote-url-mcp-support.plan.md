---
name: Near 支持 Remote URL MCP（Streamable HTTP）
overview: 让 Near 客户端原生支持「远程 URL 型 MCP」（Streamable HTTP / SSE），与 Cursor/Claude Desktop 对齐；同时打通 Enterprise Gateway `/v1/mcp/{server_id}/*` 反代链路。
todos: []
isProject: false
---

Planned-with: claude-opus-4.8
Plan-Id: 2026-06-22-near-remote-url-mcp-support
Plan-File: .cursor/plans/2026-06-22-near-remote-url-mcp-support.plan.md

# Near Remote URL MCP 支持

## 0. 上下文（实施者必读）

**问题来源：** Tushare 官方 MCP 写法

```json
{
  "mcpServers": {
    "tushareMcp": { "url": "https://api.tushare.pro/mcp/?token=..." }
  }
}
```

放进 `~/.agenticx/mcp.json` 后，Near 启动时 `load_mcp_config` 因 `MCPServerConfig.command` 是 Pydantic 必填字段，**整份 mcp.json 解析失败**，UI 表现为「尚未发现 MCP 服务」，其余 12 个 stdio MCP 也加载不出来。

**根因两条：**
1. `agenticx/tools/remote_v2.py` 的 `MCPServerConfig` 与 `MCPClientV2._create_session` 只支持 stdio（`StdioServerParameters` + `stdio_client`），完全没有 HTTP/SSE 路径。
2. `agenticx/tools/remote.py::load_mcp_config` 对每个 server 直接 `MCPServerConfig(name=name, **server_data)`，单条解析失败会让整文件抛错；上层 `agenticx/cli/studio_mcp.py::load_available_servers` 对**整个文件** `except: continue`，无法做条目级隔离。

**有利的现状：**
- `agenticx/cli/mcp_schema.json` 已定义 `command` 或 `url` 二选一（含 `headers`），即配置层 Schema 已支持，运行时未实现 ——「断层」需要补齐。
- 项目已依赖 `mcp>=1.0.0,<2`（见 `pyproject.toml` L101-104），官方 SDK 自带 `mcp.client.streamable_http.streamablehttp_client` 与 `mcp.client.sse.sse_client`，无需新增依赖。
- Enterprise Gateway 侧 Streamable HTTP 托管已通（见 `docs/guides/machi-remote-mcp.md`、`.cursor/plans/2026-06-08-gateway-mcp-server-hosting.plan.md`），现有 Cursor / `@modelcontextprotocol/inspector` 可用，缺的就是 Near 客户端 transport。

**Goal:** 让 Near 在 `~/.agenticx/mcp.json` 中能写 `url + headers` 条目，直接连远程 MCP 服务器（含 Tushare、Enterprise Gateway `/v1/mcp/{server_id}/streamable-http`），与 stdio MCP 在 UI / `/api/mcp/*` / 工具调用链路上完全对等。

**Architecture:** 
- 协议层：复用官方 `mcp` SDK 的 `streamablehttp_client`（P0/P1）与 `sse_client`（P2）。
- 配置层：`MCPServerConfig` 新增 `transport` / `url` / `headers`，与 schema 对齐；自动从 `url` 推断 transport。
- 运行时：`MCPClientV2._create_session` 按 transport 分支。
- 防御：`load_mcp_config` / `load_available_servers` 改造为「条目级容错」，**禁止单条 url 失败拖垮整份 mcp.json**。

**Tech Stack:** Python 3.11+, Pydantic v2, `mcp` SDK ≥1.0, FastAPI, AnyIO, TypeScript (Desktop 设置 UI 仅做小幅展示适配)

**非目标：**
- 不实现 OAuth / Dynamic Client Registration（仅静态 Bearer Token via `headers`）。
- 不引入新依赖（`mcp` SDK 已自带 streamablehttp_client / sse_client）。
- 不动 Enterprise Gateway 服务端代码（已可用）。
- 不在本 plan 内做 stdio→HTTP 桥接进程。

---

## 关键现有代码定位（供实施时直接跳转）

| 文件 | 行 | 现状 | 本 plan 是否需要改 |
|---|---|---|---|
| `agenticx/tools/remote_v2.py` | L73-88 | `MCPServerConfig` 只有 stdio 字段，`command` 必填 | ✅ 必改 |
| `agenticx/tools/remote_v2.py` | L196-238 | `_create_session` 硬编码 `StdioServerParameters + stdio_client` | ✅ 必改（分支） |
| `agenticx/tools/remote.py` | L59-74 | 旧 `MCPServerConfig`（被 `__init__.py` re-export） | ✅ 同步扩字段 |
| `agenticx/tools/remote.py` | L868-888 | `load_mcp_config`：单条失败抛错 | ✅ 改条目级容错 |
| `agenticx/cli/studio_mcp.py` | L459-476 | `_serialize_server_config`：写回 mcp.json | ✅ 兼容新字段 |
| `agenticx/cli/studio_mcp.py` | L512-540 | `_precheck_mcp_command`：对 url 条目跳过 | ✅ 必改 |
| `agenticx/cli/studio_mcp.py` | L671-720 | `mcp_connect_async`：browser-use 类预检 | ✅ 兼容 url（跳过 command 类预检） |
| `agenticx/cli/mcp_schema.json` | 全文 | 已支持 url + headers | ✅ 无需改（验证一次即可） |
| `agenticx/studio/server.py` | L3511-3582 | `/api/mcp/servers` 仅返回 `command` | ✅ 增加 `url` / `transport` |
| `desktop/src/components/SettingsPanel.tsx` | L8964 附近 | MCP 列表展示 | ✅ 展示 url 替代空 command |
| `tests/test_*mcp*.py` | — | 现有覆盖 stdio | ✅ 新增 url 路径冒烟 |

---

## Phase 1 (P0)：防御性容错 —— 必做、最先做

**目标：** 即使本 plan 后续 Phase 全部 rollback，至少要保证「写错一个 url 条目，不会拖垮 12 个 stdio MCP」。这是与用户已发现 bug 直接对应的最小修复。

### Task 1.1：`load_mcp_config` 改为条目级容错

**Files:**
- Modify: `agenticx/tools/remote.py`（L868-888 `load_mcp_config`）

**Requirements:**
- FR-1.1.1：对 `servers_data` 中的每个 (name, server_data) 用单独 `try/except` 包裹 `MCPServerConfig(name=name, **server_data)`，单条失败仅记录 `logger.warning("skip MCP entry %s: %s", name, exc)` 并 `continue`，不影响其它条目。
- FR-1.1.2：返回 dict 中只包含成功解析的条目；调用方维持原签名 `Dict[str, MCPServerConfig]` 不变。
- AC-1.1.1：单元测试 —— 给 `load_mcp_config` 喂 `{ "good": {"command": "echo"}, "bad": {"url": "https://x"} }`，**Phase 1 尚未实现 url，所以 bad 应被 skip**；返回 dict 仅包含 `good`，无异常抛出。
- AC-1.1.2：调用方 `load_available_servers`（`studio_mcp.py` L544-571）行为保持不变（其本身的 file 级 `except: continue` 不受影响）。

### Task 1.2：新增冒烟测试

**Files:**
- Create: `tests/test_mcp_config_entry_level_tolerance.py`

**Requirements:**
- FR-1.2.1：用 `tmp_path` 写一个含 `command` 与含 `url` 的混合 mcp.json，断言 `load_mcp_config` 不抛错、`load_available_servers` 也不抛错、且 `good` 条目在返回里。
- AC-1.2.1：测试在 `pytest tests/test_mcp_config_entry_level_tolerance.py -q` 下绿。

### Task 1.3：UI 文案提示（最小改动）

**Files:**
- Modify: `desktop/src/components/SettingsPanel.tsx`（L8964 附近 "尚未发现 MCP 服务" 文案区域）

**Requirements:**
- FR-1.3.1：当后端 `/api/mcp/servers` 返回的某条目 `command` 为空但 `url` 字段（**Phase 2 引入后**）存在时，列表行展示「remote: <url>」而非空 command；Phase 1 阶段仅保证不会渲染崩溃（防御 undefined）。
- AC-1.3.1：手工验证：写一个仅含 url 的条目，Settings → MCP Tab，**不再出现整页空状态**；该 url 条目在 Phase 1 阶段 skip（列表仅显示其它 stdio 条目）。

**Phase 1 退出标准：** 用户重现原 bug 步骤（在 mcp.json 加入 `tushareMcp: { url: ... }`），其它 12 个 stdio MCP 依然能加载与连接；UI 不空白。

---

## Phase 2 (P1)：MCPServerConfig + MCPClientV2 支持 Streamable HTTP

### Task 2.1：扩展 `MCPServerConfig`（remote_v2.py 与 remote.py 双份对齐）

**Files:**
- Modify: `agenticx/tools/remote_v2.py`（L73-88）
- Modify: `agenticx/tools/remote.py`（L59-74，旧版 MCPServerConfig）

**Requirements:**
- FR-2.1.1：新增字段，**保持向后兼容**：

```python
class MCPServerConfig(BaseModel):
    name: str
    # Transport 二选一（stdio | streamable_http | sse）
    transport: Optional[Literal["stdio", "streamable_http", "sse"]] = None
    # stdio 路径
    command: Optional[str] = None       # 改为 Optional！
    args: List[str] = Field(default_factory=list)
    env: Dict[str, str] = Field(default_factory=dict)
    cwd: Optional[str] = None
    # remote 路径
    url: Optional[str] = None
    headers: Dict[str, str] = Field(default_factory=dict)
    # 公共
    timeout: float = 60.0
    enabled_tools: List[str] = Field(default_factory=list)
    assign_to_agents: List[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_transport(self) -> "MCPServerConfig":
        if self.url and not self.command:
            self.transport = self.transport or (
                "sse" if self.url.rstrip("/").endswith("/sse") else "streamable_http"
            )
        elif self.command and not self.url:
            self.transport = self.transport or "stdio"
        else:
            raise ValueError(
                f"MCP server '{self.name}' must specify exactly one of `command` or `url`"
            )
        return self
```

- FR-2.1.2：`agenticx/tools/__init__.py` re-export 不变；`MCPServerConfig` 两份须**字段一致**（remote.py 的 MCPServerConfig 与 remote_v2.py 的等价），可通过让 `remote.py` 从 `remote_v2.py` 导入并 re-export，或两边并维持同步（推荐前者，避免漂移）。
- AC-2.1.1：以下三种输入都能成功构造，且 `transport` 字段被正确推断：
  1. `{name: "x", command: "echo"}` → `transport == "stdio"`
  2. `{name: "x", url: "https://a/mcp"}` → `transport == "streamable_http"`
  3. `{name: "x", url: "https://a/sse"}` → `transport == "sse"`
- AC-2.1.2：两者同时给（`command` + `url`）或都不给应抛 `ValueError`，错误信息含 server 名。
- AC-2.1.3：现有 `tests/test_browser_use_preflight.py` 等仅传 `command` 的旧用例**全部仍绿**。

### Task 2.2：`MCPClientV2._create_session` 按 transport 分支

**Files:**
- Modify: `agenticx/tools/remote_v2.py`（L99-249，特别是 `_create_session` 内 L196-238 块）

**Requirements:**
- FR-2.2.1：保留现有 stdio 分支（行为 100% 不变）；新增 streamable_http 与 sse 分支。
- FR-2.2.2：实现示例：

```python
# 在 _create_session 内，根据 self.server_config.transport 分支
if self.server_config.transport == "stdio":
    # 现有逻辑：StdioServerParameters + stdio_client
    ...
elif self.server_config.transport == "streamable_http":
    from mcp.client.streamable_http import streamablehttp_client
    transport_cm = streamablehttp_client(
        url=self.server_config.url,
        headers=self.server_config.headers or None,
        timeout=timedelta(seconds=self.server_config.timeout),
    )
    streams = await self._exit_stack.enter_async_context(transport_cm)
    # streamablehttp_client 返回 (read, write, get_session_id_callback)
    read_stream, write_stream, _get_session_id = streams
elif self.server_config.transport == "sse":
    from mcp.client.sse import sse_client
    transport_cm = sse_client(
        url=self.server_config.url,
        headers=self.server_config.headers or None,
    )
    read_stream, write_stream = await self._exit_stack.enter_async_context(transport_cm)
else:
    raise ToolError(f"unsupported transport: {self.server_config.transport}", self.server_config.name)

# 后续 ClientSession 创建与 initialize 与原 stdio 路径完全一致
session = await self._exit_stack.enter_async_context(
    ClientSession(read_stream=read_stream, write_stream=write_stream, ...)
)
init_result = await session.initialize()
```

- FR-2.2.3：`_is_recoverable_mcp_transport_error`（L51-70）保持不变；HTTP 路径出现 `httpx.ReadError` / `ConnectionResetError` 等同样应能触发现有重试一次的逻辑。
- FR-2.2.4：HTTP 路径的 ToolError 文案中**严禁打印 `headers` 值**（含 Bearer token），仅记录 URL 主机名与状态码。
- AC-2.2.1：用 `mcp` SDK 自带的 `examples` 中的 streamable_http server（或本 plan 在 Task 2.5 提供的 mock）作为目标，`discover_tools()` 能返回工具列表；`call_tool` 能拿到结果。
- AC-2.2.2：将 `headers={"Authorization": "Bearer wrong"}` 指向需要鉴权的本地 mock，应抛 ToolError，且日志中不含 Bearer 值。

### Task 2.3：`mcp_connect_async` 与 `_precheck_mcp_command` 跳过 url 条目

**Files:**
- Modify: `agenticx/cli/studio_mcp.py`（`_precheck_mcp_command` L512-540，`mcp_connect_async` L671-720）

**Requirements:**
- FR-2.3.1：`_precheck_mcp_command(cfg)` 在 `cfg.transport != "stdio"` 时直接返回 `(True, "")`，不做 `shutil.which` 检查。
- FR-2.3.2：`mcp_connect_async` 中 `browser-use` 类预检（`_is_stock_browser_use_mcp_config`）也只对 stdio 条目执行。
- FR-2.3.3：`_serialize_server_config`（L459-476）按 transport 写回：stdio 写 `command/args/env/cwd`，remote 写 `url/headers`；公共字段 `timeout/enabled_tools/assign_to_agents` 不变。
- AC-2.3.1：url 条目通过 `/api/mcp/connect` 能成功（在有 mock server 的前提下）；mcp.json 写回后再 reload，url 条目能被再次解析、状态保持。

### Task 2.4：`/api/mcp/servers` 暴露 url 与 transport

**Files:**
- Modify: `agenticx/studio/server.py`（L3511-3582 `list_mcp_servers`）

**Requirements:**
- FR-2.4.1：每个 server entry 在现有字段基础上补充：
  - `"url": str(getattr(cfg, "url", "") or "")`
  - `"transport": str(getattr(cfg, "transport", "stdio") or "stdio")`
- FR-2.4.2：现有 `"command"` 字段保留，url 条目此值为空字符串（已是默认行为）。
- AC-2.4.1：`curl http://127.0.0.1:<port>/api/mcp/servers` 返回的 JSON 中，stdio 条目 `transport=="stdio"`，url 条目 `transport in ("streamable_http","sse")` 且 `url != ""`。

### Task 2.5：本地 mock MCP server（供测试使用）

**Files:**
- Create: `tests/fixtures/mock_streamable_http_mcp.py`

**Requirements:**
- FR-2.5.1：用官方 `mcp.server.fastmcp.FastMCP` 在 `127.0.0.1:0`（随机端口）跑一个最小 server，注册一个 `echo(text: str) -> str` 工具，transport=`streamable-http`，path=`/mcp`。
- FR-2.5.2：以 `pytest fixture` 形式提供 `streamable_http_mcp_url`（返回 `http://127.0.0.1:<port>/mcp`），用例结束后关闭。
- AC-2.5.1：fixture 在被另一个测试导入并使用时可正常启停，无端口泄漏。

### Task 2.6：端到端冒烟测试

**Files:**
- Create: `tests/test_mcp_remote_streamable_http.py`

**Requirements:**
- FR-2.6.1：用 Task 2.5 的 mock server，构造 `MCPServerConfig(name="mock", url=<fixture url>)`，断言：
  1. `MCPClientV2.discover_tools()` 返回包含 `echo` 工具。
  2. `MCPClientV2.call_tool("echo", {"text": "hi"})` 返回结果含 `"hi"`。
  3. 重复调用 5 次复用同一会话（验证持久化），无 `_create_session` 额外重入。
- FR-2.6.2：构造一个不可达 url（`http://127.0.0.1:1`，几乎必然 connection refused），断言抛出明确的 ToolError 而不是挂住（验证 connect 超时按 `cfg.timeout` 生效）。
- AC-2.6.1：`pytest tests/test_mcp_remote_streamable_http.py -q` 全绿；总耗时 < 20s。

**Phase 2 退出标准：** Tushare 官方写法可在 `~/.agenticx/mcp.json` 中直连成功（前提是有有效 token），Enterprise Gateway 的 `/v1/mcp/{server_id}/streamable-http` + `Authorization: Bearer agx-pat-...` 写法也能成功连接并列出工具。

---

## Phase 3 (P2)：SSE transport + Desktop UI 优化

> Phase 3 可在 Phase 2 上线后单独评估是否做。Phase 1+2 已满足 Tushare / Gateway 等主流场景。

### Task 3.1：SSE transport 端到端

**Files:**
- 在 Task 2.5 基础上新增 `tests/fixtures/mock_sse_mcp.py`
- Create: `tests/test_mcp_remote_sse.py`

**Requirements:**
- FR-3.1.1：sse 分支在 Task 2.2 已实现，本 Task 仅补 mock + 测试。
- AC-3.1.1：SSE mock server 上能完成 `discover_tools` + `call_tool` 各一次。

### Task 3.2：Desktop 设置页表单优化

**Files:**
- Modify: `desktop/src/components/SettingsPanel.tsx`

**Requirements:**
- FR-3.2.1：MCP 列表中 url 条目展示「🌐 <host>」+ transport badge（streamable-http / sse）；命令 / args / env 区域改为只读的 「URL + Headers（脱敏，仅显示 key）」。
- FR-3.2.2：「添加 MCP」表单新增「Remote URL」选项卡，含 URL 与 Headers KV 编辑。
- FR-3.2.3：保存时直接写回 `~/.agenticx/mcp.json`，复用现有 `/api/mcp/raw` PUT；Header 值在前端 store 中不与未授权用户共享（不写 localStorage）。
- AC-3.2.1：用户全程不需要手编 JSON，即可在 Near 设置面板添加并连接一个 Tushare remote MCP。

### Task 3.3：Enterprise Gateway 一键发现（可选）

**Files:**
- Modify: `desktop/src/components/SettingsPanel.tsx`
- Modify: `agenticx/studio/server.py`（如需新增代理端点）

**Requirements:**
- FR-3.3.1：Settings → MCP → 「Enterprise Gateway」按钮，输入 `gateway base url + PAT` 后调用 `GET {base}/mcp/registry`，把每个 server 一键写入 `mcp.json`（`url=endpoints.streamable-http`，`headers.Authorization="Bearer <PAT>"`）。
- AC-3.3.1：填入网关地址与 PAT 后，能看到注册中心的 MCP 列表并选择性导入。

---

## 验证与回归清单（实施完成时全部跑）

1. `pytest tests/test_mcp_config_entry_level_tolerance.py tests/test_mcp_remote_streamable_http.py tests/test_browser_use_preflight.py tests/test_mcp_state_quarantine.py tests/test_mcp_restore_quarantine.py tests/test_studio_mcp_default_seed.py tests/studio/test_mcp_connect_status_api.py -q` 全绿。
2. 手工：在 `~/.agenticx/mcp.json` 同时配置 1 个 stdio MCP（如 bocha-search-mcp）+ 1 个 url MCP（如 Tushare），重启 `agx serve`：
   - `/api/mcp/servers` 两个条目都出现且 transport 字段正确。
   - 两个都能 `/api/mcp/connect` 成功，工具列表非空。
   - 把 url MCP 的 token 故意改错，重连应失败但**不影响 stdio 条目**。
3. 手工：在 Near Desktop 中通过设置面板查看 MCP 列表，url 条目可见、状态正确（不再显示「尚未发现 MCP 服务」）。

---

## 安全与边界

- **Headers 含密钥（PAT / token）**：禁止写入任何日志 / 错误响应 / `/api/mcp/raw` GET 返回前的脱敏需另议（**本 plan 不脱敏**，因为 `/api/mcp/raw` 已是 desktop-token 鉴权的本机管理面）。但 ToolError 与 `logger` 输出**必须**只含 host，不含 `headers`。
- **HTTPS 校验**：默认走 SDK 默认行为；不暴露「关闭校验」开关；如未来需要私有 CA，再单独开 plan。
- **timeout 行为**：`cfg.timeout` 既作为 connect timeout 也作为 read timeout 上限；与 stdio 路径保持一致语义。
- **代理**：HTTP transport 走系统代理（与 `agx serve` 进程一致，不重新实现）；如需要 `NO_PROXY` 覆盖，依靠现有 env。

---

## 文档与发布

- Modify: `docs/guides/machi-remote-mcp.md`，新增「Near 直接配置 remote URL MCP」章节，与现有「Cursor / Inspector」章节并列。
- Release Notes（下次版本）：`feat(mcp): Near now supports remote URL MCPs (Streamable HTTP / SSE) — Tushare and Enterprise Gateway hosted MCPs can be added directly in ~/.agenticx/mcp.json.`

---

## Commit 计划（参考）

按 Phase 拆 commit，每个 commit 含对应 Plan-Id trailer：

1. `fix(mcp): tolerate per-entry parse failures in load_mcp_config` — Task 1.1 + 1.2 + 1.3
2. `feat(mcp): extend MCPServerConfig with transport/url/headers` — Task 2.1
3. `feat(mcp): support streamable-http transport in MCPClientV2` — Task 2.2 + 2.3 + 2.4
4. `test(mcp): add streamable-http mock server and e2e smoke` — Task 2.5 + 2.6
5. （Phase 3 各 task 独立 commit）

每个 commit 必须含：

```
Plan-Id: 2026-06-22-near-remote-url-mcp-support
Plan-File: .cursor/plans/2026-06-22-near-remote-url-mcp-support.plan.md
Plan-Model: claude-opus-4.8
Impl-Model: composer-2.5
Made-with: Damon Li
```
