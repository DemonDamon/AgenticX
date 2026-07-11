# Near 原生连接器 MVP

Planned-with: gpt-5.6-sol-medium
Suggested-Impl-Model: gpt-5.3-codex（主进程/CLI/MCP）+ composer-2.5-fast（UI）
Status: implementation-ready

## 目标

保留现有「连接器」设置页，交付两个真实可用的首批连接器：

1. 腾讯会议：调用官方 `@tencentcloud/tmeet` 内置跨平台二进制，使用 OAuth2 Device Code 扫码授权。
2. TAPD：用户填写 Personal Access Token，Near 写入受管 stdio MCP 配置并调用现有 `connectMcp`。

现有 GitHub、Gmail、Notion、Slack、Google Drive、Airtable、Supabase、BigQuery 卡片继续展示，但必须用红色「暂不可用」标记；不得再以 `+` 暗示可连接。

## 根因与证据

- 现有 `desktop/src/components/settings/connectors/ConnectorsTab.tsx` 只有静态 fixture，全部点击 `+` 后显示 Toast，没有真实状态。
- 腾讯会议官方 npm 包 `@tencentcloud/tmeet` 自带 macOS arm64/x64、Windows x64 二进制；`tmeet auth login --no-browser` 输出授权 URL并轮询结果，凭证由 CLI AES-256-GCM 本地加密。
- TAPD 可使用 Personal Access Token；`@xihe-lab/tapd-mcp-server` 提供 stdio MCP，环境变量使用 `TAPD_ACCESS_TOKEN`。
- Near 已有 `mcpGetRaw` / `mcpPutRaw` / `connectMcp`，无需新建 OpenConnector sidecar或云端 OAuth Broker。

## In scope

- TAPD MCP 作为 npm 依赖；腾讯会议 CLI 不作为 npm 依赖安装，避免其 `postinstall` 主动登出用户。
- 腾讯会议首次连接时由主进程下载固定 `@tencentcloud/tmeet@1.0.11` tarball，校验 npm SHA-512 后仅提取当前平台二进制和 LICENSE。
- 腾讯会议连接成功后生成 Near 管理的本地 Skill，使 Agent 可调用官方 CLI；断开时只移除带 `.near-managed` 标记的目录。
- Electron 主进程提供腾讯会议 `status/login/logout` 和 TAPD 配置写入 IPC。
- 连接器卡片显示绿色「可用」或红色「暂不可用」。
- 已连接连接器在聊天输入区左下方显示可见入口。
- 原生连接器状态注入 Meta-Agent 系统提示；腾讯会议状态不得由同名 MCP 配置推断。
- 可用卡片打开详情/配置 Modal；不可用卡片禁用连接动作。
- TAPD 保存后连接当前 `sessionId`；腾讯会议扫码完成后回显已连接。
- 单元测试、Desktop build。

## Out of scope

- OpenConnector、云端 OAuth Broker、Gmail/Notion OAuth。
- QQ 邮箱 IMAP/SMTP。
- 修改现有 MCP Tab、飞书、微信或 `agenticx/studio/server.py`。
- 把第三方 Token 写入聊天或 localStorage。

## Task 1：纯函数与测试

- Create: `desktop/tests/native-connectors-core.test.ts`
- Create: `desktop/electron/native-connectors-core.ts`
- Modify: `desktop/package.json`

定义并测试：

- `parseTmeetAuthStatus(stdout)`：`Logged in` → connected；`Not logged in` → disconnected；其它 → error。
- `extractAuthorizationUrl(stdout)`：只接受 `https://meeting.tencent.com/...`。
- `buildTapdMcpEntry(command, entrypoint, token)`：
  - command 为 Electron 可执行路径；
  - args 为 TAPD MCP entrypoint；
  - env 含 `ELECTRON_RUN_AS_NODE=1`、`TAPD_ACCESS_TOKEN`、`TAPD_API_BASE_URL=https://api.tapd.cn`；
  - 不修改其它 MCP entries。
- catalog availability：腾讯会议/TAPD 为 `available`，其它首批 fixture 为 `unavailable`。

## Task 2：主进程接线

- Modify: `desktop/electron/main.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/global.d.ts`

### 腾讯会议

- `resolveTmeetBinaryPath()` 从 `~/.agenticx/connectors/tencent-meeting/1.0.11/` 选择当前平台二进制。
- 首次扫码前下载固定 npm tarball，30 秒超时、20 MB 上限、SHA-512 校验、临时目录解压和原子 rename；禁止执行上游 npm lifecycle script。
- 已连接时写入 `~/.agenticx/skills/near-connectors/tencent-meeting/SKILL.md`；不得覆盖或删除未带 `.near-managed` 标记的用户目录。
- IPC：
  - `native-connector-status({id})`
  - `native-connector-tmeet-login`
  - `native-connector-tmeet-logout`
- login 使用 `auth login --no-browser`，捕获 stdout/stderr 中的官方 HTTPS URL，主进程 `shell.openExternal`，最长等待 5 分钟；不记录凭证。

### TAPD

- `configure-native-connector-tapd({sessionId, accessToken})`：
  - 校验非空和长度；
  - 先调用 TAPD `GET /workspaces/projects` 校验 Token，通过后才落盘；
  - 校验 15 秒超时；
  - `mcp.json` 不存在（404）时按空文档创建；
  - 已存在 TAPD entry 时先断开旧进程，再写 Token 并重连；
  - 读取 `~/.agenticx/mcp.json`；
  - 仅合并 `tapd` entry；
  - entrypoint 使用 `require.resolve("@xihe-lab/tapd-mcp-server")`；
  - 原子写回后调用 Studio `/api/mcp/connect`；
  - Renderer 只收到 `{ok,error}`，错误不得回显 Token。

## Task 3：连接器 UI

- Modify: `desktop/src/components/settings/connectors/ConnectorsTab.tsx`
- Modify: `desktop/src/components/SettingsPanel.tsx`
- Add assets: `desktop/src/assets/connectors/tencent-meeting.svg`, `tapd.svg`（中性文字图标，不复制未知许可品牌图）。

`SettingsPanel` 传入当前 `sessionId` 与 MCP refresh callback。

卡片规则：

- `available`：右侧绿色点 +「可用」；保留居中 `+`。
- `unavailable`：右侧红色点 +「暂不可用」；不渲染 `+`。
- `connected`：绿色点 +「已连接」；提供断开/登出。
- `connecting`：Loader +「连接中」。
- `error`：红色错误文案贴近卡片。

详情弹窗：

- 腾讯会议：说明权限与本地凭证，按钮「扫码连接」；授权中不关闭状态；成功刷新。
- TAPD：文档外链、单一 password 输入框、按钮「保存并连接」；失败保留弹窗并透出底层错误。

## Verification Contract

```bash
cd desktop
npx vitest run tests/native-connectors-core.test.ts
npm run build
```

手动验证：

1. 腾讯会议和 TAPD 显示绿色「可用」；其余 8 项显示红色「暂不可用」且无 `+`。
2. 腾讯会议点击连接后打开官方扫码页；授权成功后显示「已连接」；登出恢复可用态。
3. TAPD Token 保存成功后 `tapd` 出现在 MCP 状态，当前 session 连接成功。
4. TAPD 失败保留弹窗；任何界面、日志、错误中不显示 Token。
5. MCP、微信、飞书现有行为无回归。

## Task 4：对话侧状态一致性

- Create: `desktop/src/components/connectors/ConnectedConnectorChips.tsx`
- Modify: `desktop/src/components/ChatPane.tsx`
- Modify: `agenticx/runtime/prompts/meta_agent.py`
- Test: `tests/test_native_connector_prompt.py`

- Electron 主进程把腾讯会议非敏感连接状态原子写入
  `~/.agenticx/connectors/native-status.json`（0600，不含 Token）。
- ChatPane 合并腾讯会议原生状态与 TAPD MCP 状态，在输入区操作栏显示连接器图标入口。
- Meta-Agent 提示明确：腾讯会议原生连接器使用 Skill `tencent-meeting`，不是 MCP；
  `tencent-meeting-mcp` 的状态不得覆盖原生连接状态。
- 对话中询问“腾讯会议是否已连接”时，回答必须与设置页及输入区状态一致。

## Definition of Done

- 两个绿色连接器均具备真实后端动作，不是视觉占位。
- 红色连接器不会触发假连接。
- 测试与 build 通过。
- 仅修改本计划列出的路径。
