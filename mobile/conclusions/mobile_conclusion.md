---
module_id: mobile
module_name: Mobile
roots:
  - mobile
summary_schema: code-module-summaries/v1
summary_path: mobile/conclusions/mobile_conclusion.md
---

# Mobile

产品名 **Near Mobile**（`mobile/app.config.ts` 的 `name`；slug `nearx-mobile`；版本 `1.0.0`）。Expo SDK 57 + React 19.2 + React Native 0.86 + Expo Router 的竖屏客户端，只连一台已配对的 Near 桌面端网关，不在手机上跑 Agent。

> 结论落盘：`mobile/conclusions/`（custom layout）。ownership 扫描 root 为整个 `mobile/`。路由在 `mobile/app/`（`mobile/AGENTS.md` 里写的 `src/app/` 是 Expo 模板说明，与本仓库不符）。

## Responsibility

- 扫码或粘贴配对链接，把 `gateway_base` / `device_id` / `mobile_token` 写入本机安全存储，之后所有 Gateway 调用带安装标识与 token。
- 首页发首条消息时懒创建会话；会话列表只读展示桌面端已有会话；消息页发送文本，并在首页侧附带图片、技能 slug、飞书文档引用。
- 把桌面消息线折成用户气泡、助手 Markdown、以及可折叠的回合过程卡（思考 + 工具）。
- 全局审批悬浮卡：轮询待确认项，批准或拒绝。
- 展示桌面在线状态、活动模型、当前工作目录，并把模型 / 工作目录选择写回桌面侧。

明确不拥有：

- Agent 运行时、工具执行、会话落盘、模型路由、技能索引、飞书文档正文拉取。手机只消费 Gateway 的 `/api/mobile/*` 与 `/ws/mobile`。
- 桌面端配置与 MCP 进程。`GatewayClient.getToolsRegistry` / `getMcpServers` 已实现，当前没有任何屏幕调用它们。
- iOS / Android 原生工程目录。`mobile/.gitignore` 忽略 `/ios` 与 `/android`，原生行为只经 `app.config.ts` 与 config plugin 配置（Continuous Native Generation）。

## Entry points and public interfaces

| 入口 | 路径 / 符号 | 角色 |
|------|-------------|------|
| 包脚本 | `mobile/package.json`：`expo start` / `--android` / `--ios` / `--web`；`test` → `vitest run` | 开发与单测。锁文件是 `package-lock.json`，仓库内无 `bun.lock` |
| Expo 配置 | `mobile/app.config.ts`：`scheme: "nearx"`，`userInterfaceStyle: "light"`，`ios.bundleIdentifier` / `android.package` = `com.nearx.mobile` | 应用身份与插件 |
| 路由根 | `mobile/app/_layout.tsx`：`RootLayout` | Stack + 全局 `ConfirmCard` |
| 首页 | `mobile/app/index.tsx`：`Index` | 未建会话的起始对话页 |
| 配对 | `mobile/app/pair.tsx`：`PairScreen`、`parseConnectUrl` | 扫码 / 手动绑定 |
| 会话列表 | `mobile/app/sessions.tsx`：`SessionsScreen` | 10s 轮询状态与会话 |
| 消息流 | `mobile/app/sessions/[id].tsx`：`SessionMessagesScreen` | 发送、伪流式、真流式 |
| 设置 | `mobile/app/settings.tsx`：`SettingsScreen` | 展示绑定并解绑 |
| HTTP/WS | `mobile/src/api/client.ts`：`GatewayClient`、`ApiError` | 唯一出站客户端 |
| 绑定存储 | `mobile/src/store.ts`：`getBinding`、`saveBinding`、`clearBinding`、`setPendingSend` | SecureStore / Web localStorage |
| 发布 | `mobile/eas.json`、`mobile/RELEASE.md`、`mobile/scripts/gen-keystore.sh` | EAS 内部分发与 Android 上传密钥 |

`parseConnectUrl` 只接受 `{scheme}://{host}[:port]/connect/{session_id}`。`session_id` 字符集为 `[a-z0-9_-]+`。

## Core execution path

### 绑定

1. `useGateway` 读 `getBinding()`。三项（`gateway_base`、`device_id`、`mobile_token`）缺一视为未绑定，`client` 为 `null`。
2. 首页在 `binding === null` 且没有 `loadError` 时只显示加载指示。读存储尚未返回，和已经确认未绑定，这一帧长得一样，代码没有在未绑定时 `replace("/pair")`。
3. 进入配对页的路径：首页初始化失败后的「去配对」；首页「选择任务运行位置」里的「连接你的电脑」；任意已绑定请求返回 401（`useGateway` 清绑定并 `router.replace("/pair")`）；设置页解绑成功。
4. `PairScreen.handleBind`：`getInstallId()` → `GatewayClient.bind(connectSessionId)` → `POST /api/mobile/bind`（不带 token）→ `saveBinding` → `notifyBindingChanged` → `router.replace("/")`。
5. HTTP 409：文案为该二维码已绑定其它设备。404：二维码无效或已过期。其它 `ApiError` 展示 `detail`。非 `ApiError`（fetch 失败）展示无法连接网关。扫码失败后相机保持锁定，直到用户点「重新扫码」。Web 不打开相机，默认展开手动输入。

### 首页发首条消息

1. 已绑定后拉 `getStatus`、`getSessions`、`getWorkspaces`、`getModels`。失败静默，不挡输入。
2. 工作目录：优先 `getPreferredWorkspace()`，否则用最近一条带 `workspace_dir` 的会话。
3. `handleStart` 要求正文、图片或文档至少一项，然后 `createSession`（可选 `workspace_dir`）。图片 / 技能 / 文档经 `setPendingSend` 放内存，不进路由参数。
4. `router.push("/sessions/[id]")`，query 带 `initialText`（正文为空时标题用「图片」或「文档」）。返回首页会清空草稿并解除 sending。

模型切换走 `PUT /api/mobile/models/active`。选择器脚注写明切换对后续新建任务生效。图片最多保留 4 张，`ImagePicker` quality `0.7`，转成 `data:{mime};base64,...`。飞书文档搜索在加号面板内，500ms 防抖，请求 `GET /api/mobile/docs?q=`。

### 会话消息

1. 进入页拉 `getMessages`，经 `buildChatEntries` 渲染；同时拉 `getSessionContextUsage`（失败静默）。
2. `initialText` 或 `takePendingSend()` 非空时自动发一次（`autoSentRef` 防重复）。`sender_name` 固定为 `"Near 手机"`。
3. 发送瞬间在列表末尾追加乐观 user 气泡和 `pending`。`openTurnStream` 连 `ws(s)://…/ws/mobile?install_id&token`，发送 `{type:"subscribe", session_id}`。`turn_delta` 入队，约 45ms 一帧经 `applyStreamDelta` 上屏；积压超过 25 / 60 / 150 字符时每帧取 2 / 3 / 4 字。连接失败返回 `null`，回合仍靠 `sendMessage`。
4. 发送期间每 2s `getMessages`。快照里还没有与本次正文相同的 user 消息时不替换列表，避免乐观气泡被旧快照盖掉。替换时保留 key 为本次 pending 的条目以及 `streaming` 气泡。
5. `sendMessage` 返回后停轮询，等打字机队列播完（最长兜底 30s），再 `fetchMessages`。若 `pending_confirm` 非空则 `notifyConfirmsChanged`。另外在 5s 与 15s 各补拉一次消息。重拉失败时用响应里的 `reply` 做纯文本助手气泡。
6. 流式气泡用 `splitStreamThinking` 拆 `<think>` / `<thinking>`：思考段纯文本（最多 8 行），闭合后的正文走 `AssistantMarkdown`。回合结束后由服务端消息线重建为 `TurnProcessCard` + Markdown，不再留流式气泡。
7. 列表是 inverted `FlatList`。路由参数 `sessionMode` 被读出，消息页没有使用它。

`buildChatEntries` 把一个回合里的 tool 消息和 assistant `reasoning` 收成一条 `turnProcess`。过程还在消息线尾部时 `running=true`（默认展开）；助手正文落地后折叠，并用 user 时间戳到最后一步的时间差做「任务耗时」。同秒时间戳得到的 0 秒记为 `durationMs: null`。`aggregateProcessSteps` 把相邻同类工具合成「执行 N 条命令 / 读取 N 个文件」等一行。

### 列表、审批、解绑

- `SessionsScreen` 每 10s `getStatus` + `getSessions`。`ApiError` 503 且 detail 含 `offline` 时保留旧列表并标桌面离线。其它错误进「刷新失败」。点行进入消息页并带上 `title`、`model`、`sessionMode`。页脚进 `/settings`。右下角加号 `router.dismissAll()` 回到首页。
- `ConfirmCard` 挂在根布局，已绑定时每 5s `GET /api/mobile/confirms`，多个 pending 只显示 `created_at` 最新的一条。决策 `POST /api/mobile/confirms/{request_id}`，body `{approved, reason?}`。拒绝原因可选；批准不传 reason。成功后本地收起并广播 `confirmsChanged`，消息页跟着重拉。
- 解绑：`DELETE /api/mobile/bindings` → `clearBinding` → `notifyBindingChanged` → 回配对页。设置页只展示 `device_id` 与 `gateway_base`，不展示 token。

`usePolling` 挂载立刻打一次，App 不在 `active` 时跳过，回前台补一次，上一轮未完成则跳过本轮。

## Data and configuration

绑定键（原生走 `expo-secure-store`，Web 降级 `localStorage`，注释写明 Web 实现是空壳）：

| 键 | 含义 |
|----|------|
| `agx.install_id` | 首次 `Math.random` UUID，非密钥 |
| `agx.gateway_base` | 配对 URL 的 scheme://host[:port] |
| `agx.device_id` | bind 响应 |
| `agx.mobile_token` | bind 响应；除 bind 外随 `x-agx-mobile-token` |
| `agx.preferred_workspace` | 下次新建任务的工作目录 |

鉴权头：`x-agx-install-id`，以及非 bind 请求的 `x-agx-mobile-token`。非 2xx 抛 `ApiError {status, detail}`，detail 优先取 JSON `detail`。401 先跑 `onUnauthorized` 再抛。

`normalizeSession`：`session_id`→`id`，`session_name`→`title`，`execution_state !== "idle"`→`running`，小于 `1e12` 的时间戳当秒转毫秒。`normalizeMessage`：`content`→`text`。其余字段原样保留。

明文局域网：

- iOS：`NSAppTransportSecurity.NSAllowsLocalNetworking = true`（`app.config.ts`）。
- Android：`mobile/plugins/with-uses-cleartext-traffic.ts` 把 `android:usesCleartextTraffic` 设为 `true`。插件注释写明这是为 `http://192.168.x.x` 网关。

EAS（`mobile/eas.json`）：`preview` 为 internal + Android APK；`production.autoIncrement: true`；`submit.production.ios.ascAppId` 仍是占位字符串 `"<TODO: Apple 账号创建后填>"`。上传密钥脚本默认产出 `mobile/android-upload.keystore`（别名 `nearx-mobile`，RSA 2048 / PKCS12 / 10000 天），该文件被 `mobile/.gitignore` 的 `*.keystore` 排除。

视觉 token 在 `mobile/src/ui/theme.ts`：主橙 `#FB7703`，奶油底 `#FFF7F0`，只做浅色。品牌图为 `mobile/assets/brand/near-box.png`。

## Dependencies

上游：用户操作与 Expo Router。没有仓库内其它包 import `mobile/`。

下游（全部经 `GatewayClient`，实现不在本模块）：

| 调用 | 用途 |
|------|------|
| `POST /api/mobile/bind` | 配对，无 token |
| `GET /api/mobile/status` | 桌面在线与名称 |
| `GET/POST /api/mobile/sessions` | 列表 / 懒创建 |
| `GET …/messages`、`GET …/context_usage`、`POST …/send` | 消息、用量、发送 |
| `GET /api/mobile/confirms`、`POST …/confirms/{id}` | 审批 |
| `DELETE /api/mobile/bindings` | 解绑 |
| `GET /api/mobile/models`、`PUT /api/mobile/models/active` | 模型清单与切换 |
| `GET /api/mobile/workspaces`、`/skills`、`/docs` | 工作目录、技能、飞书文档搜索 |
| `GET /api/mobile/tools`、`/mcp` | 客户端有方法，界面未用 |
| `WS /ws/mobile` | `subscribe` / `turn_delta` / `turn_done`；失败则只靠 REST |

`describeError`：503 且 detail 匹配 `/offline/i` →「桌面端离线」；504 →「桌面端响应超时」；其它 `ApiError` 用 `detail`；非 API 错误 →「无法连接网关，请检查网络」。

## Tests and operations

- `npm test`（在 `mobile/`）跑 Vitest。覆盖文件：
  - `mobile/src/lib/messages.test.ts`：`buildChatEntries` 的 running/折叠、reasoning 合并、同秒耗时为空、tool target/command、`applyStreamDelta`、`splitStreamThinking`（含未闭合标签与尾部截断前缀）。
  - `mobile/src/lib/codeTokenize.test.ts`：`commentStyleFor`、`tokenizeCode` 的关键字/字符串/注释/数字/函数名。
- 仓库内没有 mobile 的 Detox / Maestro / Playwright 套件。
- 发布步骤在 `mobile/RELEASE.md`：Android `npx eas-cli build -p android --profile preview`；iOS 走 TestFlight，需自备 `com.nearx.mobile` 的 App ID。本结论未执行过 EAS 构建。
- 开发命令以 `package.json` 为准：`npx expo start`。`AGENTS.md` 里的 `bunx` 分支在本目录不适用（没有 `bun.lock`）。

## Unverified or ambiguous

- Gateway 是否在 `send` 返回前持续推 `turn_delta`、以及 5s/15s 补拉是否仍必要，取决于桌面/网关实现，本模块只实现了降级与补拉。
- 未绑定冷启动会停在首页加载指示，直到某条失败路径把用户带去配对页。代码注释写「未绑定 → pair」，跳转本身没有写在 `binding === null` 的分支里。
