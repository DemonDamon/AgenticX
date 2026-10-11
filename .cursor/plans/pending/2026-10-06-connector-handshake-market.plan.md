# 连接市场握手与实例化

Planned-with: Composer
Suggested-Impl-Model: Composer 2.5

> 连接市场：点「连接」→ 命名实例 → 「使用」。登录/扫码必须在产品弹层完成并支持过期刷新，禁止把会过期的登录链接写进对话。

## 根因

当前桌面有三套互不同步的供给：原生 CLI 墙、MCP 市场、连接器网关 sidecar。对话里生成扫码链接会过期，用户来不及扫就失效。网关核心目前只认 `none` / `api_key`，与四种握手（`none` / `api_key` / `custom_credential` / `oauth2`）未对齐。公共大目录不能伪造「已连接」——没有官方远程 MCP 端点与密钥就不能宣称可调用。

## In scope

- FR-1：原生企业微信默认扫码接入；弹层展示二维码；过期由主进程换新 URL 推渲染层；托管 skill 禁止在对话生成登录链。
- FR-2：连接实例按握手类型分派创建（`none` 也建记录但不存密）。
- FR-3：连接市场 / 我的连接：卡片「连接」打开对应握手表单，成功后出现在「我的连接」。
- FR-4：已有原生能力（GitHub / 飞书 / 企业微信 / 腾讯会议 / TAPD / Agent Mail）与已装 MCP 走真实安装，不新增空壳。

## Out of scope

- 不为外部 SaaS 伪造执行器或假「已连接」。
- 不把渠道（IM 飞书/微信绑定）与连接器实例混成同一套存储。
- 企业 OpenAPI 导入流程不在本 plan 重做。

## 本期已落地（FR-1）

- `desktop/electron/native-connectors-core.ts`：`extractWecomLoginUrl` / `wecomInitLooksExpired` / `wecomInitLooksSuccess`
- `desktop/electron/main.ts`：`runWecomQrInitViaPty` + `startWecomLogin({ mode })`；progress 含 `waiting_scan` + `loginUrl`
- `ConnectorsTab`：扫码 / 填写凭据双形态；QRCode 绘在弹层
- 托管 skill：未登录引导设置页，禁止对话内登录链

## 后续任务（Composer 可独立实施）

### Task A：网关 auth 四元联合

**Files:** `connector-runtime/internal/model/model.go` 约 AuthType 常量；`internal/connection/connection.go` Secret；`api` 创建连接。

- 增加 `custom_credential`、`oauth2`；`none` 保持兼容别名 `no_auth` 输入。
- 测试：`model_test.go` 非法 type 拒绝；oauth2 缺 tokenUrl 拒绝。

### Task B：市场列表与「我的连接」（部分落地 2026-10-07）

**已做：** 市场顶栏一等 `连接器` Tab；`connector-supply.ts`（native|mcp|gateway + auth）；默认只渲染 wired；未接线默认隐藏，可展开后点「暂未接线」说明层（不伪造已连接）；已接线「连接」→ 握手弹层，不进聊天；精选「连接常用工具」跳到连接器 Tab。

**已做（续 2026-10-07）：** 「我的连接」实例列表 + 确认删除（`my-connections-model.ts` / `MyConnectionsPanel.tsx`）；市场连接器 Tab 子视图「浏览 | 我的连接」；设置 → 连接器页顶栏同面板；删除走 native logout / `disconnectMcp` + `mcpPutRaw`，并回调刷新 health SSOT。

**已做（续 UI 2026-10-07）：** 去掉「显示尚未接入」开关，目录始终全量展示；连接器网关补齐图标；MarketIcon 统一白底 contain 框；Comate 风格 stub 目录（钉钉/轻流/知识星球/地图/文档/代码等）带 auth + authFormHint（none→name_only、api_key、token、oauth_device），未接线仍「暂未接线」不伪造连接。

**未做：** `custom_credential` / api_key / name-only **真实创建表单**写回 mcp.json；全量握手实例化（命名实例 / 多实例）；Task A 网关 auth 四元落地到 runtime；Task C oauth2 桌面回调扩展。

### Task B（原描述）

**Files:** `desktop/src/components/settings/connectors/` 新建 supply 表（kind=native|mcp|gateway，auth=四类）；`ConnectorsTab` 或市场 Tab 只渲染 kind 已接线的卡片。

- 未接线条目展示「需官方 MCP 地址 + 密钥」，表单为 `custom_credential`（url + token），写入本机 MCP 配置后才算已连接。
- AC：点已接线卡片「连接」不打开聊天；「我的连接」能看到实例；删除走现有 logout/uninstall。

### Task C：oauth2 桌面回调

对齐现有 GitHub Device Flow / 飞书两段授权，不在聊天里发授权 URL。

## 供给判定（实施时对照，不整表抄进 commit）

| 握手 | Near 真实路径 |
|---|---|
| none（CLI 登录后） | 设置 → 连接器：企业微信扫码、飞书、GitHub、腾讯会议、Agent Mail |
| api_key | TAPD token；高德等已装 MCP 的 env key |
| custom_credential | 用户粘贴官方 Streamable HTTP MCP URL + token |
| oauth2 | 仅已实现 Device Flow 的原生项；其余等 Task C |

## 验收

- AC-1：`desktop/tests/native-connectors-core.test.ts` 覆盖 WeCom URL 白名单与过期文案。
- AC-2：设置弹层扫码出现二维码；过期后 `loginUrl` 更新；聊天无登录 URL。
- AC-3：未提供远程 MCP 的条目不能显示已连接。
