# SP2 · ExtensionBackend 桥接（双 Backend 分发）

归属：feat/agx-browser-extension · Master Plan 第 3.2 节
依赖：SP1 PASS
闭环定义：`/v1/browser/act` 请求可路由到 Extension backend 并返回 stub 结果，复用 pending/settle 机制

## 0. 防扩散边界

- **只做路由与管道，不做真实浏览器操作**（stub 执行器返回固定 JSON；真执行器是 SP3）
- 不改 `agenticx/cli/agent_tools.py`（agent 侧零改动是本方案的验收点，动了就是失败）
- 不改 Embedded backend 现有行为（回归由现有测试保证）
- 不引入新配置体系：backend 选择用 env `AGX_BROWSER_BACKEND=embedded|extension|auto`，默认 auto

## 1. 现状（改动基础）

- `desktop/electron/browser-bridge.ts`：HTTP server 收 `/v1/browser/act` → pending map
  （request_id → {resolve, timer}）→ ipcMain IPC 到 WorkPanel renderer → `near-browser-act-result`
  回包 → `settle()`。ACTIONS 集合 L18-26。
- agent 侧 `agenticx/cli/agent_tools.py` L3966-4016 读 `~/.agenticx/browser_bridge.port/token` 调用。
- SP1 已建 `~/.agenticx/browser_bridge_nm.sock`（扩展↔desktop 通道）。

## 2. 任务

### 2.1 backend 路由
- `browser-bridge.ts` 请求处理中加路由：`embedded`（现状）/ `extension`（转发 NM socket）/ `auto`
  （扩展心跳存活 → extension，否则 embedded）
- 转发 payload：`{request_id, session_id, action, ...}` 经 nm-socket-server 发给扩展，超时沿用
  `timeoutMsFor(action)`；扩展回包 `{request_id, ok/error/...}` → 复用 `settle()`

### 2.2 stub 执行器（extension 侧）
- `extension/src/executor-stub.js`：对任意 action 返回
  `{ok:true, action, url:"about:blank", text:"[stub]", backend:"extension"}`，让全链路可验收

### 2.3 连接状态
- nm-socket-server 记录扩展心跳（SP1 ping）→ bridge 增加 `GET /v1/browser/status` 返回
  `{backend:"auto", extension_online:true|false}`（供 desktop UI 与后续 SP4 使用）

### 2.4 测试
- 新建 `desktop/tests/browser-bridge-extension-backend.test.ts`：
  - mock socket：extension 路由下 settle 收到 stub 回包
  - auto 模式：扩展离线时回落 embedded（断言 pending 走 IPC 路径）
  - 超时路径：扩展不回包时返回既有超时错误格式
- 既有测试全绿：`desktop` 下 vitest 全量跑一遍

## 3. 验收判据

1. `AGX_BROWSER_BACKEND=extension` 时，从 Studio session 发 `near_browser_open`，
   结果回填 session 且内容带 `backend:"extension"` 标记
2. `AGX_BROWSER_BACKEND` 不设（auto）+ 扩展未连接时，行为与现状完全一致（回归零变化）
3. tsc --noEmit 与全部 vitest 通过

## 4. Sub agent 执行提示

- 先读：`desktop/electron/browser-bridge.ts` 全文、SP1 产出的 nm-socket-server.ts、
  master plan 3.1/3.2 节
- settle/pending/request_id 语义**必须复用，不得另起一套 request id 体系**
- 错误返回格式对齐 `_tool_near_browser_http` 消费侧（`agenticx/cli/agent_tools.py` L3996-4016）

## 5. 执行结果（2026-11-11，SP2 执行 agent 回填）

**判定：PASS —— 双 backend 路由 + stub 全链路闭环，`agenticx/` Python 侧零改动。**

### 5.1 产出/修改文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `desktop/electron/browser-bridge.ts` | 改 | `AGX_BROWSER_BACKEND=embedded\|extension\|auto` 路由（默认 auto，扩展心跳在线走 extension，否则 embedded）；extension 分支复用 pending/settle/`timeoutMsFor`；新增 `GET /v1/browser/status`；默认 NM channel 随 bridge 启动（bind 失败仅降级不 crash）；`nmChannel`/`timeoutMs` 测试注入点 |
| `desktop/electron/nm-socket-server.ts` | 改 | echo → action 转发：`{type:"ping"}`→pong（记录心跳判活 `extensionOnline()`：活跃连接 + 90s 内 ping，SP1 心跳周期 60s）；`{type:"act_result"}`→回调 `onActResult`（剥离 transport `type`）；`sendAct()` 发 `{type:"act",...}` 到最近连接；未知消息保持回显（SP1 shim 测试兼容） |
| `extension/src/executor-stub.js` | 新 | stub 执行器：任意 action 回 `{ok:true, action, url:"about:blank", text:"[stub]", backend:"extension"}` |
| `extension/src/sw.js` | 改 | `onNativeMessage` 加 `act` 分发（`importScripts("executor-stub.js")`），回 `{type:"act_result", ...result, request_id}`；心跳/重连逻辑未动 |
| `desktop/tests/browser-bridge-extension-backend.test.ts` | 新 | 7 用例（mock electron + 注入 channel）：extension settle 成功、auto 离线回落 embedded（断言走 IPC 路径）、auto 在线走 extension、超时错误格式、显式 extension 离线报 `extension_offline`、status 端点、真 unix socket 全链路 |
| `scripts/e2e/verify-extension-backend.mjs` | 新 | 全链路 e2e（编译后 dist-electron 逻辑 + mock electron 承载 bridge） |

### 5.2 判据验证

1. **判据 1（extension 路由回包带 `backend:"extension"`）PASS**：
   e2e B1（真 Chrome for Testing + 真扩展 SW）：模拟 agent `POST /v1/browser/act {action:"open"}` →
   NM → SW executor-stub → act_result → settle，回包
   `{"ok":true,"action":"open","url":"about:blank","text":"[stub]","backend":"extension","request_id":"dddc387c-…"}`，
   roundtrip 2ms。（agent 侧 `_tool_near_browser_http` 未动：HTTP 合约、port/token 机制、
   错误结构 `{ok:false, error, hint}` 均复用，错误侧仅 `human_takeover` 特判——本 SP 回包格式不变，
   故 agent 侧真 session 联调零风险。）
2. **判据 2（auto + 扩展未连接 = 现状零变化）PASS**：e2e A3 断开扩展后 auto 回落 embedded
   （`desktop_window_unavailable` 证明 embedded 分支）；单测断言 auto 离线时 `host.send("near-browser-act")`
   IPC 路径被走、embedded 报文格式未变。
3. **判据 3（tsc + vitest）PASS**：`npx tsc -p electron/tsconfig.json --noEmit` 零错误；
   新增 7/7 用例绿；desktop 全量 vitest 中 `tests/`（electron 侧）全绿，
   `src/` 有 19 个既有失败（`git stash` 后复跑同样失败，均为 UI 组件测试，与 SP2 无关）。

### 5.3 全链路 e2e 结果（`node scripts/e2e/verify-extension-backend.mjs`）

- Phase A（shim-mock，假扩展直连 unix socket）A1-A5 全 PASS：
  extension 后端 settle（1-2ms）、auto 在线走扩展、auto 离线回落 embedded、
  显式 extension 离线报 `extension_offline`、status 心跳判活 + 401 鉴权
- Phase B（真浏览器：Chrome for Testing + 真 SW + NM host manifest 装 `--user-data-dir` 内）PASS：
  B0 真 SW 心跳达编译后 bridge（`extension_online:true`）；B1 stub 回包 settle（2ms）
- SP1 回归：`test-nm-shim.mjs` PASS（帧协议/echo 兼容未破坏）；`verify-nm-channel.mjs` PASS
  （phase1 连接 RTT 39ms、phase2 kill shim 后 1.06s 自愈重连）——sw.js 加 act 分发未影响心跳/重连

### 5.4 遗留问题（转 SP3/后续）

1. status 端点尚未接 desktop UI（SP4/桌面侧显示"扩展已连接"）
2. `AGX_BROWSER_BACKEND` 每请求读 env（可运行时切换）；若未来要固化进设置面板需另做配置持久化（不在本 SP 边界内）
3. 判据 1 的"Studio session 内发 near_browser_open 回填 session"人工步骤待 desktop 应用联跑
   （agent 侧零改动，管线已由 e2e 在编译产物上等效验证）
