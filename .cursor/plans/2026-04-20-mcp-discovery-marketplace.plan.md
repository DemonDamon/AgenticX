# MCP 设置升级：品牌扫描 + 内置编辑器 + ModelScope 市场

## 背景

桌面端 `SettingsPanel.tsx` 的 MCP Tab 目前只支持：
1. 只读主路径 `~/.agenticx/mcp.json`；
2. 手动填写其他 `mcp.json` 绝对路径。

用户痛点（见讨论记录 [MCP 设置灵活度需求](c1e78b58-mcp-discovery-chat)）：
- 要自己记忆/查找每个 AI 工具（Cursor / OpenClaw / Hermes-agent / Trae / Codex / Claude Code 等）的 MCP 配置路径；
- mcp.json 解析失败只能去文件系统里手改，没有内置编辑器；
- 缺少"从 MCP 市场安装"的发现机制（对标 Trae / ModelScope 广场的 UX）。

后端能力底座已经就绪：`agenticx/cli/studio_mcp.py` 的 `all_mcp_config_search_paths()` / `load_available_servers()` / `import_mcp_config()` / `_DEFAULT_MCP_ENTRIES` 已能复用，本方案**只新增**能力层，不重写现有流程。

## 目标

新 MCP Tab 采用三段式：**当前（已配置）| 发现（品牌扫描）| 市场（ModelScope）**。配合内置 Monaco JSON 编辑器，把"找路径 → 手改 JSON → 市场安装"从外部操作收口到 Machi 内部。

## Non-goals（第一版不做）

- 不解析 Cherry Studio 的 Electron leveldb 用户数据（只检测是否安装 + 提示从 Cherry UI 导出）。
- 不在 Monaco 里为 JSON5 / YAML / TOML 做完整 schema lint；YAML/TOML/JSON5 只在桌面默认编辑器里打开。
- Marketplace 不做收藏、评论、上传；只做消费 ModelScope 公开 API。
- 不改现有"连接/断开 + auto_connect"逻辑（前期 plan 已落地）。

## Requirements

### FR 功能需求

- **FR-1 品牌扫描**：`GET /api/mcp/discover` 返回按 OS 探测的 15 个常见 AI 工具 MCP 配置命中情况（brand / display_name / path / format / exists / parseOk / serverCount / servers[] / parseError?）。
- **FR-2 导入为主，仅链接为次**：发现卡片主按钮 **[导入]** 走 `import_mcp_config()` 合并进 `~/.agenticx/mcp.json`；次操作（折叠菜单）包含 **[仅链接]**（追加到 `mcp.extra_search_paths`）和 **[在系统编辑器打开]**。
- **FR-3 内置 Monaco 编辑器**：`GET /api/mcp/raw?path=...` 返回原文 + 解析错误行列；`PUT /api/mcp/raw` 做"临时文件 → schema 校验 → 原子 rename"，失败回滚不动源文件。前端 `MCPJsonEditorModal` 仅对 JSON 启用富编辑；其他格式只读预览 + 打开系统编辑器。
- **FR-4 ModelScope 市场**：`GET /api/mcp/marketplace` 代理 `PUT https://www.modelscope.cn/openapi/v1/mcp/servers`，带 30 分钟内存缓存；`GET /api/mcp/marketplace/{id}` 代理详情接口。支持 14 个 category、`is_hosted`、`is_verified`、`search` 过滤。
- **FR-5 一键安装**：市场卡片 `+` 触发"拉详情 → 动态表单（按 `env_schema.required`）收集环境变量 → 合并写入 `~/.agenticx/mcp.json` → 写入 `mcp.auto_connect` → 立即触发 connect"。
- **FR-6 错误闭环**：MCP 服务行"查看详情"旁新增 **[用编辑器修复]** 按钮，直接打开 Monaco 编辑器定位到出错文件。

### AC 验收标准

- **AC-1**：Mac 上同时装过 Cursor / Trae / Claude Desktop / AgenticX 时，`/api/mcp/discover` 至少返回这 4 条有效 `parseOk=true` 的命中。
- **AC-2**：OpenClaw `~/.config/openclaw/openclaw.json5`（JSON5 + `mcp.servers` 嵌套）、Hermes `~/.hermes/config.yaml`（YAML + `mcp_servers`）、Codex `~/.codex/config.toml`（TOML + `[mcp_servers.*]`）任一存在且非空时，discover 能正确读出 server 名称和 command。
- **AC-3**：Monaco 编辑器改坏 `~/.agenticx/mcp.json`（故意删逗号）点保存，后端校验失败返回行列号，源文件不变。
- **AC-4**：从市场安装 `@modelcontextprotocol/fetch` 后，`~/.agenticx/mcp.json` 里多出 `fetch` 条目，`mcp.auto_connect` 包含 `fetch`，MCP Tab 列表出现绿色点。
- **AC-5**：`pytest tests/cli/test_mcp_discovery.py tests/studio/test_mcp_discovery_api.py tests/studio/test_mcp_raw_api.py tests/studio/test_mcp_marketplace_api.py` 全部通过。
- **AC-6**：`desktop/e2e` 新增的 smoke 用例（扫描一次 / 市场搜一次 / 编辑器开一次）通过。

## 品牌探测表（Task 2 实现依据）

| brand | OS path（优先级从上到下，同 brand 取先命中） | format | key path |
|---|---|---|---|
| `agenticx` | `~/.agenticx/mcp.json` | json | `mcpServers` / 顶层 |
| `cursor` | `{CWD}/.cursor/mcp.json`, `~/.cursor/mcp.json` | json | `mcpServers` |
| `claude_desktop` | mac `~/Library/Application Support/Claude/claude_desktop_config.json` / win `%APPDATA%\Claude\claude_desktop_config.json` / linux `~/.config/Claude/claude_desktop_config.json` | json | `mcpServers` |
| `claude_code` | `~/.claude.json`, `~/.claude/settings.json` | json | `mcpServers` |
| `trae` | `{CWD}/.trae/mcp.json`, `~/.trae/mcp.json` | json | `mcpServers` |
| `openclaw` | `~/.config/openclaw/openclaw.json5` | json5 | `mcp.servers` |
| `hermes` | `~/.hermes/config.yaml` | yaml | `mcp_servers` |
| `codex` | `~/.codex/config.toml` | toml | `mcp_servers.*` table |
| `windsurf` | `~/.codeium/windsurf/mcp_config.json` | json | `mcpServers` |
| `continue` | `~/.continue/config.json`, `~/.continue/config.yaml` | json/yaml | `mcpServers` |
| `cline` | mac `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` + linux/win 等价 | json | `mcpServers` |
| `zed` | `~/.config/zed/settings.json` | json | `context_servers` |
| `vscode` | mac `~/Library/Application Support/Code/User/settings.json` + linux/win 等价 | json | `mcp.servers` |
| `gemini_cli` | `~/.gemini/settings.json` | json | `mcpServers` |
| `cherry_studio` | mac `~/Library/Application Support/CherryStudioDev` 存在即视为装了，但**不解析** | detect-only | — |

每条 reader 返回统一中间模型：

```python
@dataclass
class DiscoveredServer:
    name: str            # server key
    command: str | None  # stdio
    args: list[str]
    env: dict[str, str]
    url: str | None      # sse/http
    headers: dict[str, str]
    timeout: float | None

@dataclass
class BrandHit:
    brand: str
    display_name: str
    icon: str            # 图标 key，前端映射
    path: str            # 已展开的绝对路径
    format: Literal["json","json5","yaml","toml","detect-only"]
    exists: bool
    parse_ok: bool
    server_count: int
    servers: list[DiscoveredServer]
    parse_error: str | None
```

## ModelScope API 合约（Task 4 依据）

- List：`PUT https://www.modelscope.cn/openapi/v1/mcp/servers` body `{"filter":{"category?":str,"is_hosted?":bool}, "page_number":int, "page_size":int, "search":str}`。
- Detail：`GET https://www.modelscope.cn/openapi/v1/mcp/servers/{id}`，含 `server_config: [ {mcpServers: {...}} ]`（多个变体）、`env_schema: JSONSchema`、`is_hosted` / `is_verified` / `readme`。
- 分类枚举：`browser-automation | search | communication | customer-and-marketing | developer-tools | entertainment-and-media | file-systems | finance | knowledge-and-memory | location-services | art-and-culture | research-and-data | calendar-management | other`。
- 鉴权：匿名可列表和看详情；`is_hosted=true` 服务运行时往往需要用户的 ModelScope token（写入 server `env`）。后端若检测到环境变量 `MODELSCOPE_API_TOKEN` 就在代理请求里带上 `Authorization: Bearer ...`；用户侧第一版不需要登录。

## Task 拆解

> 每个任务都带"完成判定"。每次只推进一个 in_progress todo；完成前先跑 AC 对应的验证命令。

### Task 1 — 依赖更新

- `pyproject.toml` / `requirements.txt`：新增
  - `json5>=0.9.25,<1`（读 JSON5，`pyjson5` 备用）
  - `tomli>=2.0,<3; python_version<"3.11"`（Python 3.10 无 stdlib `tomllib`）
- `desktop/package.json`：新增 `@monaco-editor/react` + `monaco-editor`（默认已提供 TS types，无需额外 @types）。
- **验证**：`pip install -e ".[dev]"` 成功；`cd desktop && npm i` 成功；`python -c "import json5, tomllib"`（3.11+）或 `import json5, tomli`（3.10）通过。

### Task 2 — `agenticx/cli/mcp_discovery.py`（+ 单测）

- 实现品牌探测表（上表），每条 brand 一个 reader 函数，返回 `list[BrandHit]`。
- 暴露 `detect_all(cwd: Path | None = None) -> list[BrandHit]`。
- 单测 `tests/cli/test_mcp_discovery.py`：
  - Mock home dir / cwd，准备 fixture JSON / JSON5 / YAML / TOML；
  - 覆盖：文件不存在 / 解析成功 / 解析失败（保留 parse_error）/ 空 servers / 带 URL 的 SSE server。
- **验证**：`pytest tests/cli/test_mcp_discovery.py -v` 全绿。

### Task 3 — `agenticx/cli/mcp_schema.json`

- JSON Schema Draft 2020-12，描述：顶层是 `object`（要么直接是 server map，要么 `mcpServers` 包着）；每个 server 必须至少有 `command`（+ 可选 `args` `env` `cwd` `timeout`）或 `url`（SSE/HTTP，+ 可选 `headers` `timeout`）；互斥。
- 单测 `tests/cli/test_mcp_schema.py`：用 `jsonschema` 验证合法 / 非法样例。
- **验证**：`pytest tests/cli/test_mcp_schema.py -v` 全绿。

### Task 4 — Studio 后端 API（`agenticx/studio/server.py`）

- `GET /api/mcp/discover` → 调 `detect_all()`，序列化为 JSON 返回。
- `GET /api/mcp/raw?path=...` → 读原文，尝试解析并返错误行列（仅 JSON 格式）；返 `{ok, path, format, text, parse_error?}`。
- `PUT /api/mcp/raw` body `{path, text}` → 临时文件 + JSON schema 校验 + 原子 rename；失败返 `{ok:false, error, line?, column?}`。仅允许写 `~/.agenticx/mcp.json` 和 `mcp.extra_search_paths` 白名单内的路径，越界直接 400。
- `GET /api/mcp/marketplace?category=&search=&page=&page_size=&is_hosted=&is_verified=` → 代理 ModelScope，30 分钟 in-proc LRU 缓存。
- `GET /api/mcp/marketplace/{id}` → 代理详情。
- 单测 `tests/studio/test_mcp_*_api.py`（mock httpx + 临时文件）。
- **验证**：`pytest tests/studio/test_mcp_discovery_api.py tests/studio/test_mcp_raw_api.py tests/studio/test_mcp_marketplace_api.py -v` 全绿。

### Task 5 — Electron IPC（`desktop/electron/main.ts` + `preload.ts`）

新增 handler：
- `mcp:discover`、`mcp:get-raw`、`mcp:put-raw`、`mcp:marketplace-list`、`mcp:marketplace-detail`、`mcp:marketplace-install`、`shell:open-path`。
- 所有 handler 复用 `getStudioUrl()` + `x-agx-desktop-token`。
- **验证**：手工从 DevTools `await window.agenticxDesktop.mcpDiscover()` 能返回 BrandHit 列表。

### Task 6 — 前端组件

- `desktop/src/components/settings/mcp/MCPDiscoveryPanel.tsx`：按 brand 分组卡片，主 `[导入]` + 次菜单 `[仅链接][打开文件]`；空态友好文案。
- `desktop/src/components/settings/mcp/MCPMarketplacePanel.tsx`：左侧 14 个分类 tab + 顶部搜索 + `is_hosted/is_verified` chip + 分页卡片网格 + 点 `+` 弹安装流程（`env_schema` 动态表单 → 确认 → 进度）。
- `desktop/src/components/settings/mcp/MCPJsonEditorModal.tsx`：`@monaco-editor/react` 懒加载（`React.lazy`）；挂 MCP schema；顶部文件切换下拉；保存按钮禁用条件 = 校验通过 + 有改动。
- `SettingsPanel.tsx` MCP Tab 改造：保留现有列表作为第一段"当前"；加 TabBar（当前 / 发现 / 市场 / 编辑 JSON）。现有"连接/断开/附加路径"完全保留。
- **验证**：桌面端 Dev 模式三段式正确渲染；改源文件 → UI 不闪屏；Monaco 首包不出现在 initial bundle（检查 `npm run build` 产物 + `dist/assets` 里有独立 chunk）。

### Task 7 — 错误卡片闭环

- `resolveMcpRowPresentation` 里 error 分支的"查看详情"按钮旁加 `[用编辑器修复]`，直接 open Modal 并 focus 到出错 server 的块。
- **验证**：伪造一个坏掉的 server（command 不存在），在 UI 点击 `[用编辑器修复]` 能打开编辑器且滚动到出错块。

### Task 8 — Playwright 烟雾测试

- `desktop/e2e/mcp-discovery.spec.ts`：发现 Tab 至少 1 条命中（AgenticX 自己）。
- `desktop/e2e/mcp-marketplace.spec.ts`：搜 "fetch"，断言首屏至少 1 条。
- `desktop/e2e/mcp-editor.spec.ts`：打开编辑器 → 故意输入非法 JSON → 保存失败提示出现 → 原文件不变。

### Task 9 — 文档

- `agenticx/tools/README.md`：新增"品牌扫描 + 市场"段落。
- `docs/CHANGELOG.md`：列入新增 API + 新 UI。
- `README.md` / `README_ZN.md`：在"MCP 配置"段补一段新截图。

## 执行顺序与 checkpoint

```
Task1 → Task2 → Task3 → Task4 → Task5 → Task6 → Task7 → Task8 → Task9
```

每个 checkpoint 打一个 commit（`Made-with: Damon Li` + `Plan-Id: 2026-04-20-mcp-discovery-marketplace`）。Task 6 因文件量大可拆多个 commit（Discovery / Marketplace / Editor 三段各自一个）。

## 风险与兜底

- **ModelScope API 变更**：通过 `mcp.marketplace_url` 配置项支持切换到自托管清单；响应失败时前端降级为"离线，仅展示已安装的服务"。
- **JSON5 解析差异**：`json5` 与 OpenClaw 的 json5c 可能对注释/尾逗号容忍度不同；遇到 parse_error 保留原文回传前端，让用户用 Monaco 预览（不做富编辑）。
- **Monaco 体积**：`React.lazy` + Suspense 按需加载；首屏不注入 `monaco-editor` chunk。
- **跨平台路径**：Windows 注册表方案不做；走 `%APPDATA%` / `%LOCALAPPDATA%` 环境变量判断，Linux 走 XDG。

Made-with: Damon Li
