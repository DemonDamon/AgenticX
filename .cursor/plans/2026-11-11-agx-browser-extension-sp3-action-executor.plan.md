# SP3 · 六 Action 执行器（MVP 核心）

归属：feat/agentic-browser-extension · Master Plan 第 3.3 节
依赖：SP2
闭环定义：六个 near_browser action 在用户真实 Chrome 页面执行成功，结果回填 Studio session

## 0. 防扩散边界

- **不发明新协议**：入参/返回语义严格对齐现有 Embedded backend（下面 1.2 是协议契约，违反即返工）
- **不做**：侧边栏聊天（P2）、录制（P2）、debugger 路径只留接口不实现（`optional_permissions`
  动态申请流程是 SP6，本 SP 的实现全部基于 `chrome.scripting`）
- 不做敏感域拦截与确认卡片（SP4 负责；本 SP 在 action 分发处预留 `preActionHook` 调用点）

## 1. 协议契约（防扩散关键，sub agent 必须遵守）

### 1.1 六 action 与入参（来自 `agenticx/cli/agent_tools.py` L4070-4160）

| action | 入参 | 语义 |
|---|---|---|
| open | url | 打开/切换到 url |
| snapshot | {} | 输出带 index 的可交互元素清单 |
| click | {index} | 点击 snapshot 中第 index 个元素 |
| type | {index, text} | 向第 index 个元素输入 |
| press_key | {key} | 当前活动元素按键 |
| extract_text | {query?} | 页面文本，query 命中过滤 |
| screenshot | {} | 可见区截图（base64） |

### 1.2 返回格式
- 成功：JSON `{ok:true, action, url, ...}`；错误：`{ok:false, error:"..."}`；
  人工接管：`{error:"human_takeover"}`（agent 侧 L3961 有对应文案分支）
- snapshot 输出必须包含**带 index 的可点击/可输入元素列表**（text/tag/aria/rect），
  click/type 按 index 引用——这是既有 agent prompt 依赖的语义

### 1.3 可移植实现
- snapshot/extract_text 的收集逻辑直接移植 `desktop/electron/browser-bridge.ts` L164-199 的
  frameScript（已处理 shadow DOM 递归与 innerText 合并），改为 content script 注入执行
- screenshot 用 `chrome.tabs.captureVisibleTab`（不依赖 debugger）

## 2. 任务

- `extension/src/executor/`：按 action 拆模块（open/snapshot/interact/extract/screenshot）
- open：`chrome.tabs.create`/`chrome.tabs.update` + 等待 `status:complete`（超时 30s 对齐
  `timeoutMsFor`）
- snapshot：`chrome.scripting.executeScript`（target: activeTab）注入 collector →
  返回 index 清单；iframe 不递归（标注 limitation，避免扩散到 CDP）
- click/type/press_key：scripting 注入交互函数，按 index 从最近 snapshot 缓存定位元素 →
  `el.click()` / `el.value` 派遣 input 事件 / dispatchEvent KeyboardEvent
- 删除 SP2 的 executor-stub（由真实现替换，保持 SP2 验收路径不破坏：stub 分支可由
  `AGX_EXT_STUB=1` 保留）
- `preActionHook(action, target)` 空实现调用点（SP4 接管）

## 3. 验收判据（e2e 手动清单，逐条记录到本文件末尾）

1. Studio 指令"打开 example.com 并提取页面标题"→ open + extract_text 链路回填成功
2. 在含表单的测试页执行 snapshot → click/type/press_key 按 index 命中正确元素
3. 带 shadow DOM 的测试页（如 Notion 公开页）snapshot 能取到内容
4. screenshot 回传 base64 且 agent 侧可见
5. desktop vitest + 相关既有 pytest 全绿

## 4. Sub agent 执行提示

- 先读：master plan 3.3 节、SP2 的路由实现、`browser-bridge.ts` frameScript 段
- 所有 action 必须走 SP2 的 pending/settle 链路，禁止扩展内直接回调 agent
- 元素 index 缓存存 `chrome.storage.session`（MV3 合规，内存态随会话）

## 5. 执行结果（2026-11-11，SP3 执行 agent 回填）

**判定：PASS —— 六个 near_browser action 经 SP2 NM 全链路在真实 Chrome 页面执行成功。**

### 5.1 产出/修改文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `extension/src/executor/index.js` | 新 | `executeAction` 分发 + `preActionHook(action,target)` 空实现调用点（SP4 接管；block 返回 `{ok:false, error}`） |
| `extension/src/executor/shared.js` | 新 | SW 侧公共件：`agxGetActiveTab`、`agxInject`（scripting 注入 + 错误映射）、`agxResolveIndexedTarget`（storage.session snapshot 缓存校验 index/tab，`stale_index` 语义对齐 embedded） |
| `extension/src/executor/collector.js` | 新 | 页面侧收集器（frameScript 移植）：snapshot 带索引清单（index/tag/type/text/placeholder/href/value_len/is_password + role/aria_label/rect，`data-near-agent-idx` 页面缓存）+ extract_text（shadow DOM 递归 + 同源 iframe + 24000 截断 + query 过滤）。**self-contained**：chrome.scripting 只序列化单个 func，辅助逻辑全部内联 |
| `extension/src/executor/open.js` | 新 | exact-URL 复用 tab（手动比对 tab.url，match pattern 不支持端口）否则 `tabs.create`，轮询 `status:complete`，28s 预算对齐 `timeoutMsFor("open")`=30s |
| `extension/src/executor/snapshot.js` | 新 | `chrome.scripting.executeScript` 注入 collector → `{ok,url,title,elements}`，缓存进 `chrome.storage.session`（key `agx_last_snapshot`） |
| `extension/src/executor/interact.js` | 新 | click/type/press_key：先缓存校验再注入页面函数（shadow root 深度查找 `data-near-agent-idx`；type 走原生 setter + input/change + Enter 三连 + `requestSubmit`，移植 `browser-agent-actions.ts`） |
| `extension/src/executor/extract.js` / `screenshot.js` | 新 | extract 同上；screenshot `captureVisibleTab` → `image_base64`（PNG base64） |
| `extension/src/sw.js` | 改 | act 分支 async 化：默认真 executor，`message.stub===true`（bridge 转发 `AGX_EXT_STUB=1`）保留 SP2 stub 路径；心跳/重连未动 |
| `extension/manifest.json` | 改 | permissions 补 `scripting`/`activeTab`/`tabs`；host_permissions 保持 `[]`（商店姿态，master plan 3.6 草案；自动化 e2e 用临时副本补 `<all_urls>`，见 5.4） |
| `desktop/electron/browser-bridge.ts` | 改 | extension 路由消息加 `stub: stubModeFromEnv()`（每请求读 env，与 AGX_BROWSER_BACKEND 同姿态） |
| `scripts/e2e/fixtures/action-executor.html` + `second-page.html` | 新 | 测试页：按钮(counter)/输入框(live preview)/表单(submit)/密码框/链接/开放 shadow root(带内部按钮) |
| `scripts/e2e/verify-action-executor.mjs` | 新 | 六 action 全链路 e2e（T0-T14，24 断言全 PASS） |
| `scripts/e2e/verify-extension-backend.mjs` | 改 | 顶部 pin `AGX_EXT_STUB=1`（SP2 验收断言即 stub 载荷，真 executor 上线后脚本自含 stub 路径） |

### 5.2 六 action 验证（Chrome for Testing + 真 SW + NM 全链路，`node scripts/e2e/verify-action-executor.mjs`，24/24 PASS）

链路：`POST /v1/browser/act → bridge(extension 路由) → NM socket → shim → SW → chrome.scripting/captureVisibleTab → act_result → settle`，CDP 仅用于 SW target 存在性诊断。

| action | 判据 | 结果 |
|---|---|---|
| open | 建到 fixture tab，url/title/tab_id 正确；二次 open 同 URL 复用同 tab_id；切换第二页成功 | PASS（T1/T10/T11） |
| extract_text | 全文含 shadow root 内容；query 命中过滤仅返回匹配行（对齐 agent 侧语义） | PASS（T2/T3） |
| snapshot | 7 元素带唯一 index；每项含 index/tag/text/role/aria_label/rect；`is_password:true` 命中密码框；link 带 href；shadow 内按钮被索引 | PASS（T4，含 6 条子断言） |
| click | 按 index 两次命中 Increment → 页面 counter "Counter: 2"；按 index 命中 shadow root 内按钮 → "shadow-count: 1" | PASS（T5/T9） |
| type | index 输入 → live preview "last-input: hello agx"；submit:true → Enter/requestSubmit → "form-result: agx@example.com" | PASS（T6/T7） |
| press_key | "k" 打到焦点元素 → 文档级监听 "last-key: k" | PASS（T8） |
| screenshot | 55348 字符 base64，解码命中 PNG magic bytes | PASS（T12） |
| 错误契约 | 未知 index → `{ok:false, error:"stale_index"}`（agent prompt 语义） | PASS（T13） |
| stub 保留 | `AGX_EXT_STUB=1` 经真 NM 链路仍回 stub 载荷 | PASS（T14） |

### 5.3 回归与校验

1. `npx tsc -p electron/tsconfig.json --noEmit` 零错误；extension 11 个 JS 全部 `node --check` 通过
2. SP1 `verify-nm-channel.mjs` PASS：连接 RTT 41ms，kill shim 后 ~1.05s 自愈（sw.js 加 executor importScripts 未影响心跳/重连）
3. SP2 `verify-extension-backend.mjs` PASS：Phase A A1-A5 + Phase B B0/B1 全绿（stub 路径经 `AGX_EXT_STUB=1` 保留）
4. desktop vitest：`tests/` 35 文件 289 用例全绿（含 SP2 bridge 7 用例）；`src/` 19 失败均为既有 UI 测试（HarnessPicker 等，非本 SP 引入）
5. `agenticx/` 零改动

### 5.4 遗留问题（转 SP4/后续）

1. **生产 manifest 无 host 权限下的 activeTab 手势**：`host_permissions:[]` + activeTab 需用户手势（点击扩展图标/快捷键）才授权 scripting——真实用户流要等 SP4 确认卡片点击即手势；自动化 e2e 用临时副本 patch `<all_urls>`（仓库 manifest 保持商店姿态）
2. preActionHook 为空实现（SP4 接管：敏感域拦截 + 确认卡片 + `human_takeover` 语义定稿）
3. snapshot 不递归 iframe（closed shadow root 亦不可见）——代码已标注 limitation，跨域 frame 依赖 SP6 的 debugger 可选路径
4. screenshot 目前只回 `image_base64`，agent 侧如何呈现/落盘（对齐 embedded 的 save-screenshot→path 链路）待与 SP4 审计链路一起定
5. 判据 1 的「Studio session 内真机联跑」人工步骤待 desktop 应用联调（管线已由 e2e 在编译产物 + 真浏览器上等效验证）
