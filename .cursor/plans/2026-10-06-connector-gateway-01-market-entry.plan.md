# Subplan 01：市场「连接器网关」精选条目（桌面端）

日期：2026-10-06
状态：已完成（T1-T6 全过；PoC 降级记录见下）
父计划：[connector-gateway-master](2026-10-06-connector-gateway-master.plan.md)

## 背景与目标

市场连接器 Tab 目前只有 ModelScope 单上游的 MCP server 条目。新增一条「连接器网关」精选条目：一条 MCP 配置（streamable-http）背后是 open-connector 的 1,579 服务 / 11,146+ 动作供给。安装走**本地直写**（`mcpPutRaw`），不经 ModelScope 上游。

已验证的基础设施（落地面）：
- 本地写配置桥：`window.agenticxDesktop.mcpPutRaw({path, text})`（preload.ts:582；`McpGatewayImportPanel` / `McpRemoteServerModal` 均用此通路）
- 配置工具：`desktop/src/utils/mcp-remote-config.ts`（getMcpServersMap / setMcpServersMap / buildRemoteMcpServerPayload）
- 已装判定：`marketplace/model.ts` 的 `isMcpInstalled`（按 server 名册）
- 场景分类/卡片渲染/详情弹层：`MarketplaceView.tsx`、`PluginDetailModal.tsx`、`model.ts`

## 方案

1. **纯函数层** `desktop/src/components/marketplace/gateway-model.ts`（TDD 核心）
   - `GatewayForm`：`{ mode: "hosted" | "self", url: string, token: string, serverName: string }`
   - `buildGatewayServerConfig(form)` → 单 server 的 mcpServers 配置（streamable-http + 可选 Authorization header env），token 非空才写入
   - `normalizeGatewayUrl(url)`：去尾斜杠、允许补 `/mcp` 后缀、校验 http(s)
   - 默认 serverName：`open-connector`；托管形态默认 URL：`https://connector.oomol.com/mcp`
2. **数据文件** `desktop/src/data/connector-gateway.ts`：网关条目元数据（名称/描述/供给数据/官方文档外链/双形态默认值/安全文案 key），供市场与 i18n 共用
3. **市场卡片**：连接器 Tab 置顶精选卡（复用统一条目模型，`kind: "mcp"` + `serverId: "open-connector-gateway"` 特例标记），显示「1,500+ 服务 · 11,000+ 动作 · 凭据留在网关侧」
4. **安装弹层**：双形态切换（托管一键装 / 自建填 URL+token），确认后 `mcpPutRaw` 写入当前 MCP 配置路径 → 回调刷新名册；已装态复用 `isMcpInstalled`，重复安装给提示
5. **i18n**：zh/en 双语（市场命名空间）
6. **PoC 验证**（与 Task 1 并行起步）：对可达的 OpenConnector 端点（托管 `https://connector.oomol.com`，或本地 docker）跑 `tools/list` + `search_actions` + 一个 no-auth 动作；环境不可达则记录降级（UI 照常交付，PoC 转观察项）

## 任务拆解（TDD 顺序）

| # | 任务 | 产出 | 验证 |
|---|---|---|---|
| T1 | 纯函数层 + 单测 | gateway-model.ts + gateway-model.test.ts | vitest 全绿 |
| T2 | 数据文件 | connector-gateway.ts | 编译过 |
| T3 | 市场卡片接入 | MarketplaceView/model.ts 少量扩展 | CDP 截图 |
| T4 | 安装弹层 + 编排 | 安装组件 + mcpPutRaw 接线 | CDP 实装验证 |
| T5 | i18n | zh/en 词条 | en 切换截图 |
| T6 | 集成验证 | — | marketplace 套件全绿、tsc 零新增错误、CDP 截图归档 |

## 验收标准（AC）

- AC-1：市场连接器 Tab 出现置顶「连接器网关」精选卡，展示供给规模与安全说明
- AC-2：托管形态一键安装后，本机 MCP 名册出现 `open-connector` 条目；自建形态填 URL（+可选 token）安装成功，URL 规范化生效
- AC-3：已装态判定正确（isMcpInstalled），重复安装有明确提示而非静默覆盖
- AC-4（PoC 可达时）：安装后在对话中 `search_actions("hackernews")` → `execute_action` 跑通 no-auth 动作
- TDD：gateway-model vitest 全绿；marketplace 既有用例零回退；tsc 对基线零新增错误

## 不做（本轮）

- 网关内 provider 目录的浏览/搜索 UI（G-004 死胡同卡片）
- 连接管理（OAuth 账号连接、凭据托管）UI —— 归 Enterprise 轨道
- sidecar 内置运行时（Node 版本约束；使用量信号后再评估）
- 修改 ModelScope 上游链路 / studio 后端

## 实施结果（2026-10-06）

### 交付物

- `desktop/src/components/marketplace/gateway-model.ts` + `gateway-model.test.ts`（23 用例全绿）
- `desktop/src/data/connector-gateway.ts`（网关元数据 + 双形态默认值）
- `desktop/src/components/marketplace/GatewayInstallModal.tsx`（双形态安装弹层，mcpPutRaw 本地直写 `~/.agenticx/mcp.json`）
- `desktop/src/components/marketplace/MarketplaceView.tsx`（精选卡置顶 + gateway 分派；`model.ts` 加 `gateway?: boolean` 标记）
- `desktop/src/utils/mcp-remote-config.ts` 收敛 `MCP_PRIMARY_CONFIG_PATH` 单一来源（SettingsPanel 改为导入）
- zh/en 双语词条（marketplace 命名空间 `gateway.*`，i18n parity 测试通过）

### 验证记录（CDP 实机，截图见 research/codedeepresearch/open-connector/screenshots-subplan01/）

- AC-1 ✓：全部/MCP Tab 网关卡置顶，供给规模 + 安全文案正确（01/02 号截图）
- AC-2 ✓：托管一键装后 `~/.agenticx/mcp.json` 出现 `open-connector` 条目、既有 14 个 server 完整保留、卡片切已装态（04 号截图）；自建形态输入 `192.168.1.10:9100/` 规范化为 `https://192.168.1.10:9100/mcp` 落盘
- AC-3 ✓：已装态复用 isMcpInstalled；重复打开弹层出现「已安装，再次安装将覆盖」提示（05 号截图）
- i18n ✓：en 切换后卡片/弹层全英文（07/08 号截图）
- 回归：marketplace+i18n+data 套件 112 用例全绿；tsc 对改动文件零新增错误
- 验证后已恢复现场（mcp.json 还原、locale 回 zh）

### PoC 结果（降级记录）

- 托管端点 `https://connector.oomol.com/mcp` 可达，但 `initialize` 返回 401 `token not found`——托管服务要求 runtime token（属 OOMOL 商业服务发放），与上游 `connector-runtime.ts` 的 `runtimeToken` Bearer 鉴权设计一致
- 结论：AC-4（对话内 search_actions/execute_action 跑通）**降级为观察项**——需拿到托管 token 或本地 Docker 实例后方可执行；UI 链路不受影响
- 衍生修正：安装弹层两种形态都提供 token 输入（托管形态同样需要 token），比原「托管零配置」的假设更贴合实际
