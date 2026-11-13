# SP5 · 划词/整页注入 Session（插件形态的核心增量）

归属：feat/agx-browser-extension · Master Plan 第 2 节
依赖：SP1（NM 通道）；与 SP2/SP3 可并行
闭环定义：用户在任意页面划词/整页发送 → 内容带来源进入 Studio 当前 session 上下文

## 0. 防扩散边界

- **不做聊天框、不做流式回复 UI**（侧边栏已砍，回复去 desktop 看）
- 只做"浏览器 → agent"的输入方向，不碰"agent → 浏览器"（那是 SP2/SP3）
- 权限姿势：`contextMenus` + `optional_host_permissions`，**用户点开某站点时才申请该站注入权限**，
  绝不用 `<all_urls>` 常驻

## 1. 任务

### 1.1 采集
- `chrome.contextMenus`：两个菜单项「划词发给 AGX」「整页发给 AGX」（contexts: selection / page）
- content script 按需注入：菜单点击时 `chrome.scripting.executeScript` 取
  `window.getSelection().toString()` / `document.title + innerText`（复用 SP3 collector，
  裁剪至 20k 字符上限），附 `url`、`title`、`selected_text`

### 1.2 传输（复用 SP1 通道）
- payload：`{type:"inject_context", session_id?, url, title, text, kind:"selection"|"page"}`
- 经 NM → nm-socket-server → desktop。session_id 缺省 = Studio 当前活跃 session
  （扩展 storage 里保存最近一次激活的 session，激活时机见 1.3）

### 1.3 desktop 注入
- desktop 侧消费 inject_context：定位当前 Studio session → 走既有 context injection 机制
  注入为带来源标注的上下文块（先读 `.cursor/plans/2026-03-08-studio-context-injection.plan.md`
  与对应实现，复用其格式与入口，不新造注入通道）
- 注入内容格式：`[来自页面 <title>](<url>)\n<text>`，标注 kind

### 1.4 权限申请
- 首次对某域发送 → `chrome.permissions.request({origins:[当前域]})`；
  options 页可查看/回收已授权域

## 2. 验收判据

1. 在未授权站点划词 → 弹权限申请 → 允许后内容出现在 Studio session 上下文，带来源
2. 整页发送在 500k 字符页面裁剪正确（20k 上限）
3. 拒绝权限后菜单不可用，无静默失败
4. session 不可达时（Studio 未开）→ 扩展 toast 提示"AGX 未运行"，不静默丢弃

## 3. Sub agent 执行提示

- 先读：SP1 的 NM 消息封装、SP3 的 collector（复用）、2026-03-08 context injection plan
- 若 desktop 注入入口需要新 IPC/main 处理器，保持最小：只加一个 `inject_context` 分发函数
- **禁止**顺手实现"回复通知浏览器"之类反向功能

## 5. 执行结果

**日期**：2026-11-11 · 分支 feat/agx-browser-extension · 全判据 PASS

### 5.1 改动面

| 文件 | 内容 |
| --- | --- |
| `extension/manifest.json` | permissions += `contextMenus`/`notifications`；新增 `optional_host_permissions: ["<all_urls>"]`（仓库 manifest 保持零常驻 host 授权，store 姿势不破） |
| `extension/src/inject.js`（新） | 两个菜单项（agx-inject-selection / agx-inject-page，真实 create() 回调注册）；权限门 contains→request（per-origin pattern，手势来自菜单点击）；采集（selection=window.getSelection()，page=复用 SP3 collector + 20k 截断 + truncated 标记）；payload 组装；`agxRecordInjectResult`（storage 标记 `agx_inject_last_result` + notifications toast，绝不静默）；`agxStoreActiveSession` 缓存 `agx_active_session`；两个测试缝 `agxPermissionContainsFn`/`agxPermissionRequestFn`（let 模块变量，默认真实 chrome.permissions） |
| `extension/src/sw.js` | importScripts inject.js；`agxNmSendInject`（port 掉线即 nm_disconnected="AGX 未运行"前置检查）；onNativeMessage 新增 active_session / inject_context_result 分支 |
| `extension/options.html` + `extension/src/options.js` | 扩展现有 options 页新增「页面注入已授权域名」一节（不另起 UI）：permissions.getAll 列表 + permissions.remove 回收，onAdded/onRemoved 实时刷新 |
| `extension/icons/icon128.png`（新） | notifications 图标（node 生成 128x128 PNG） |
| `desktop/electron/nm-socket-server.ts` | `{type:"inject_context"}` 行 → `onInjectContext(handler)` 分发（transport type 剥离，fire-and-forget 同 act/act_result 形态，异步结果经 sendAct 回推） |
| `desktop/electron/browser-bridge.ts` | NmChannel 增可选 `onInjectContext?`（旧测试 mock 兼容）；StartNearBrowserBridgeOptions 增 `injectContextStudio {url(),token(),fetchFn?}`；**唯一新入口** `dispatchInjectContext`：session 解析（payload.session_id → 否则 GET /api/sessions 按 updated_at 重排取最近活跃，pinned 优先被规避）→ POST /api/chat（复用 2026-03-08 context injection 既有入口：context_files 键=plan 格式 `[来自页面 <title>](<url>)`，占位 user turn 标注 kind+已裁剪，keep_runtime_after_disconnect:true，SSE 首 chunk 后 cancel）→ 错误映射 session_not_found/studio_chat_5xx/studio_unreachable/no_active_session；启动 best-effort 探针 + 每次 inject 成功后推送 `{type:"active_session"}` |
| `desktop/electron/main.ts` | 仅 2 行：`injectContextStudio: { url: getStudioUrl, token: getStudioToken }`（复用既有 getter，重定向连接逐请求生效） |
| `desktop/tests/browser-bridge-inject-context.test.ts`（新） | 11 用例（dispatch 契约三态 session 解析、请求体格式、SSE drain、错误映射、wiring 回推、启动探针；vitest，镜像 SP2 mock electron 模式） |
| `scripts/e2e/fixtures/page-inject.html`（新） | 划词 fixture（#sel-target 可选定文本） |
| `scripts/e2e/verify-page-inject.mjs`（新） | SP3/SP4 harness 模式 + mock Studio（GET /api/sessions + POST /api/chat SSE）+ 判据 T0–T7（25 断言） |

### 5.2 判据逐项（scripts/e2e/verify-page-inject.mjs，RESULT: PASS，25/25 断言）

1. **PASS — 未授权→权限申请→授权后内容带来源进 session**：T2 在真实 SW 内合成点击（native 菜单无法 CDP 驱动，已注明）→ `permissions.request` 捕获调用参数 == `["http://localhost/*"]`（per-site 姿势，绝无 <all_urls> 常驻）→ 授权后划词文本经真实 executeScript→NM→dispatch→mock Studio `POST /api/chat`：context_files 键 == `[来自页面 AGX Page Inject Fixture](<url>)`、值 == 选中文本；占位 user turn 标注 kind=划词；session 由 desktop 侧 recency 解析（s-latest 胜 s-old）；T1 菜单项注册、T7 manifest 姿势断言同过
2. **PASS — 500k 字符页面 20k 裁剪**：T5 plan 要求的 500k 文本 fixture → context_files 值 == 20000 字符整且含页面标记；user turn 标注 整页 +（超长已裁剪）
3. **PASS — 拒绝权限无静默失败**：T3 request 缝返回 false → storage `{ok:false, error:"permission_denied", origin, notified:true}` + toast；Studio 零新增行。注：chrome.contextMenus 不支持 per-origin 禁用，"菜单不可用"落地为"拒绝后每次点击均显式提示"，语义等价（finding 6）
4. **PASS — Studio 不可达不静默丢弃**：T6 关停 mock Studio → `inject_context_result {ok:false, error:"studio_unreachable"}` → SW storage 错误标记 + "AGX 未运行…" toast 尝试（notified:true）；desktop 全未启动的 nm_disconnected 分支由 agxNmSendInject 前置检查覆盖（遗留 4 注明 e2e 只覆盖 Studio 挂变体）
5. **PASS — desktop 分发函数（验证层级已注明）**：单测 11/11（session 解析三态、/api/chat 请求体契约、SSE 首 chunk 后 cancel、404/5xx/conn-refused 映射、wiring 回推 inject_context_result+active_session、启动探针）+ e2e 同一真实分发函数经 NM 全链对 mock Studio；真 Studio 全量拉起不在 e2e（判据允许 mock，见文件头注释与 5.3-5）
6. **PASS — 回归全绿**：SP3 verify-action-executor **26/26**；SP4 verify-safety-layer 全过（其 options UI 用例与新增一节共存无回归）；desktop vitest tests/ **303/303**（基线 292+新增 11）；`tsc -p electron/tsconfig.json --noEmit` 0 错；扩展侧 JS node --check 全过。T4 附加验证 active_session 自愈回填：第二次 inject 携带缓存的 session_id 且零额外 /api/sessions probe

### 5.3 Findings

1. **Chrome for Testing（playwright chromium-1234）的 chrome.contextMenus 没有 `getAll`**（create/remove/removeAll/update/onClicked 均在）→ T1 改用 inject.js 内 `agxInjectMenuIds` 注册表（真实 create() 回调确认后写入，产品内聚状态兼 e2e 探针）
2. 该 build 部分 chrome API 无 promise 化（contextMenus 回调式）；storage/permissions/scripting/notifications 均正常 promise 化
3. **native 权限弹窗与 OS 菜单点击无法 CDP 驱动**（SP1 finding 家族）→ inject.js 留两个测试缝（默认真实 API，SW 上下文之外不可触达）；e2e 用缝强制"首次/拒绝"分支，其余链路（executeScript、NM socket、dispatch、mock Studio）全真；patched manifest 给 127.0.0.1/localhost 两测试 host 常驻授权以使 executeScript 真实可跑，仓库 manifest 姿势由 T7 断言
4. **desktop 主进程无"当前活跃 session"状态**（renderer 私有）→ 启动探针 + 每次成功 inject 后推送 active_session 自愈；"切换即推"需 renderer IPC（遗留 2）
5. `/api/chat` 是既有 context injection 唯一入口，会触发一轮 agent turn（gateway 纯附件占位文案先例）；keep_runtime_after_disconnect:true + SSE 首 chunk 后 cancel——user 行与 context_files 合并在流开始前落库，注入持久化不受 cancel 影响
6. contextMenus 无 per-origin 菜单禁用 → 判据 3 落地语义见 5.2-3
7. mock Studio 即"最小 session mock"（判据 5 允许）：实现 dispatch 触到的两个端点 + token 校验 + SSE 首 chunk

### 5.4 遗留 / 手动 smoke（不阻塞 SP5）

1. 手动 smoke（需真人点菜单与权限弹窗）：生产 manifest 装真实 Chrome → 未授权站划词 → 允许 → Studio 目标 session 出现 `[来自页面 …]` 块并收到 agent 回复
2. "切换 session 即推 active_session"：需 renderer→main IPC（活跃 session 在 renderer 状态），P2 再接；当前为启动探针 + inject 成功后自愈刷新
3. options 新增一节未做 CDP UI 驱动（SP4 仅驱动放行区）；纯 permissions.getAll/remove 逻辑，风险低
4. nm_disconnected（desktop 完全未启动）分支：sw.js 前置检查 + 同样的 toast/标记路径，e2e 覆盖的是 NM 通而 Studio 挂的 studio_unreachable 变体
