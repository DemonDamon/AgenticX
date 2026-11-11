# AGX 浏览器插件 · 终端用户旅程测试用例集（USER-JOURNEYS）

> 适用版本：SP1–SP5 合入 `feat/agx-browser-extension` 后的最终交付验证。
> 组织方式：**从真实用户视角**描述完整旅程（不是模块视角）；每条旅程给出
> 前置条件、用户动作步骤、可观察的预期结果。
>
> 用例集分两部分：
> - **第一部分：自动化执行** —— `scripts/e2e/verify-user-journey.mjs`
>   一次真实浏览器会话串完 J1–J6，结果见文末「自动化执行结果」。
> - **第二部分：需真人手动执行** —— 覆盖各 SP 遗留的、自动化无法替代的
>   手动 smoke（原生右键菜单/权限弹窗的真人点击、真 Google Chrome（非
>   Chrome for Testing）开发者模式加载、2 小时长跑稳定性）。

---

## 第一部分 · 自动化执行（J1–J6）

**入口**：`node scripts/e2e/verify-user-journey.mjs`（desktop TS 先编译，随后
单浏览器 + 单 bridge 跑完六条旅程；退出码 0=PASS / 1=FAIL / 2=BLOCKED）。

**测试环境**：Chrome for Testing（playwright 缓存 `chromium-*`），
`--user-data-dir=/tmp/agx-uj-e2e-profile`，`--no-proxy-server`，NM host manifest
装在 profile 下，临时扩展副本带 `<all_urls>` 常驻授权（截图 action 需要；
仓库正式 manifest 保持申请制姿势不动）。

### J1 首次安装与连接

**用户视角**：我第一次安装 AGX 桌面端，然后在 Chrome 里装上扩展，想确认
两边连上了。

**前置条件**
- NM host 包装脚本已就位（`~/.agenticx/agx-nm-bridge-host.sh` → `scripts/nm-bridge-shim.mjs`）
- NM host manifest 已装入当前 profile 的 `NativeMessagingHosts/`，`allowed_origins` 与扩展 ID（由 manifest `key` 固定）一致
- desktop 侧 bridge 已启动（NM unix socket 监听 + HTTP 端口/token 文件落盘）

**步骤（用户动作）**
1. 打开 Chrome，`chrome://extensions` → 开发者模式 → 加载已解压的 `extension/`
2. 点击扩展图标打开 popup

**预期结果（可观察）**
- popup 状态区显示 **connected**（绿色 `ok` 样式）+ 当前 NM 往返延迟 **「NNN ms」**
- popup 连接尝试计数、最近 pong 时间随心跳刷新
- desktop 侧 `GET /v1/browser/status` 返回 `extension_online: true, backend: "extension"`

**自动化断言（4 条）**
- J1-a storage `nm.status=connected` 且记录 pong RTT（`lastRttMs` 为数值）
- J1-b `/v1/browser/status` → `extension_online=true, backend=extension`
- J1-c popup 页可作为 tab 打开（自有 origin `chrome-extension://…`）
- J1-d popup 渲染出 `status="connected"`、`rtt="NNN ms"`、class 含 `ok`

### J2 日常划词

**用户视角**：我在读一篇文章，选中一段话，想发给 AGX 让它帮我理解/存档。

**前置条件**
- J1 连接已建立；用户已进入某个 AGX 会话（活跃会话 = `s-latest`）
- 在任意普通网页（自动化：`http://localhost:PORT/page-inject.html`）

**步骤（用户动作）**
1. 用鼠标选中页面上的一段文字
2. 右键 → 菜单里点 **「划词发给 AGX」**
3. （首次在该站点）Chrome 弹出权限申请弹窗 → 点「允许」

**预期结果（可观察）**
- AGX 当前活跃会话里出现新消息，内容 = 选中的文字，且带来源标注
  `[来自页面 页面标题](页面 URL)`
- 占位 turn 标注 kind=划词 与来源 key
- 首次权限弹窗只申请当前站点 origin（如 `http://localhost/*`），不申请 `<all_urls>`
- 后续同站点划词不再弹权限

**自动化断言（6 条）**
- J2-a 两个右键菜单项已注册（`agx-inject-selection` / `agx-inject-page`）
- J2-b 划词发送成功且结果被记录（防静默失败）
- J2-c 首次权限申请 origin 恰为 `["http://localhost/*"]`
- J2-d 注入进入用户当前活跃会话且 key 为 `[来自页面 AGX Page Inject Fixture](<URL>)`
- J2-e 注入正文 = 用户选中的文字
- J2-f 占位 turn 标注 划词 + 来源

> 说明：原生右键菜单与权限弹窗不可被 CDP 自动化，脚本在真实 SW 上直接调用
> `agxHandleContextMenuClick`，并用 `inject.js` 暴露的测试缝
> （`agxPermissionContainsFn` / `agxPermissionRequestFn`，默认即真实
> `chrome.permissions` API）强制走「未授权→申请」首用分支。真人点菜单/弹窗
> 的体验由第二部分 M1 覆盖。

### J3 整页阅读

**用户视角**：我想让 AGX 把整篇文章读进来，哪怕它很长。

**前置条件**
- J2 权限已授予（localhost 站点）
- 打开超长页面（自动化：50 万字符的 `long-page.html`）

**步骤（用户动作）**
1. 在页面上右键 → **「整页发给 AGX」**

**预期结果（可观察）**
- 会话出现整页内容块，带来源标注
- 超长正文裁剪为 **恰好 20,000 字符**（开头是正文开头，不是尾巴）
- 占位 turn 标注 整页 +（超长已裁剪），如实告知用户内容不完整

**自动化断言（4 条）**
- J3-a 整页发送成功且结果被记录
- J3-b 注入块 key 为 `[来自页面 AGX Long Page Fixture](<URL>)`
- J3-c 正文长度 === 20000 且以 fixture 正文开头、含标记串
- J3-d 占位 turn 含 整页 + 已裁剪

### J4 指令驱动浏览器（agent 侧视角）

**用户视角**：我在 AGX 里说：「打开那个测试页，把标题取回来，帮我填一下
表单，再截个图」。agent 调 `near_browser_*` 工具在真实页面上执行并把结果
回填对话。

**前置条件**
- J1 连接已建立；bridge HTTP `/v1/browser/act` 可作为 agent 等效入口
- 脚本用 `fixtures/action-executor.html` 模拟被操作的站点

**步骤（agent 动作序列，等效 near_browser_open → …）**
1. `open <URL>` —— 打开指定页面并提取标题
2. `extract_text` —— 提取页面正文
3. `snapshot` —— 索引页面控件（表单输入、按钮、链接）
4. `type <email索引> "agx@example.com" submit=true` —— 帮我填表并提交
5. `click <Increment索引>` —— 点击按钮
6. `press_key j` —— 按键事件落地
7. `screenshot` —— 截取可视区
8. `open <同URL>` —— 连续指令复用同一 tab

**预期结果（可观察）**
- 每条 action 的回包都带 `ok: true` 与结构化结果（title/text/elements/
  form-result/counter/last-key/PNG），回填到 agent 对话
- 截图返回可解码的 PNG（magic bytes `\x89PNG`）
- 同 URL 二次 `open` 不重复开页（复用 tab_id）

**自动化断言（8 条）**
- J4-a open 返回 `title="AGX Action Executor Fixture"` + `tab_id`
- J4-b extract_text 含 fixture 欢迎语
- J4-c snapshot 索引 ≥6 个控件且命中表单输入/按钮
- J4-d type+submit 后页面 `form-result: agx@example.com`
- J4-e click 后 `Counter: 1`
- J4-f press_key 后 `last-key: j`
- J4-g screenshot base64 解码为 PNG 且 magic bytes 命中
- J4-h 重复 open 复用同一 `tab_id`

### J5 安全场景

**用户视角**：我让 agent 去网银页面看看余额，或者帮我在页面上填密码——
AGX 应该拦住敏感站，填密码前先弹卡片征求我同意。

**前置条件**
- J4 就绪；敏感域 deny 名单含银行类站点（自动化用 `www.icbc.com.cn`，
  仅 URL 判定，不实际访问网络）
- `fixtures/safety-page.html` 提供密码框与确认卡片操作钩子
- `AGX_HOME/config.yaml` 开启 enterprise 审计门（outbox 落盘）

**步骤（agent 试图 + 用户响应）**
1. agent `open http://www.icbc.com.cn:…/` → **应被拦**
2. agent 打开普通测试页 + `snapshot` 索引到密码框
3. agent `type <密码框> "deny-me-123"` → **确认卡片弹出** → 用户点「拒绝」
4. agent `type <密码框> "allow-me-456"` → 卡片再弹 → 用户点「允许」

**预期结果（可观察）**
- 银行 URL 返回 `{ok:false, error:"blocked: sensitive domain", blocked:true}`，
  不发生任何导航
- 高风险输入（密码框）不执行、而是渲染确认卡片；拒绝 → `user_declined`，
  页面密码框保持 `(none)`；允许 → 输入落地且回包 `confirmed: true`
- 审计 outbox 留痕：银行拦截行（outcome=blocked）与高风险放行行
  （outcome=confirmed, risk=high）

**自动化断言（8 条）**
- J5-a 银行站被敏感域拦截（error/domain 精确匹配）
- J5-b 普通测试页不被误拦
- J5-c snapshot 命中密码框与卡片操作钩子
- J5-d 填密码弹卡片、拒绝后 `user_declined`
- J5-e 被拒输入从未落页（`pw-typed: (none)`）
- J5-f 放行后输入执行且 `confirmed:true`
- J5-g 审计含银行 blocked 行
- J5-h 审计含 confirmed 高风险行

### J6 异常场景

**用户视角**：我没开 desktop 就划词——扩展要告诉我，而不是装死；之后我
开了 desktop，它自己连上；用着用着链路断了，它半分钟内自愈。

**前置条件**
- J2 的 localhost 标签页仍打开；bridge 在脚本进程内可控启停

**步骤（模拟故障 + 用户动作）**
1. 脚本停掉 bridge（等效 desktop 未启动）
2. 用户在该页划词发送
3. 脚本重启 bridge（等效 desktop 拉起）
4. 脚本 `SIGKILL` NM shim 进程（等效链路断裂）

**预期结果（可观察）**
- bridge 停止后扩展状态翻为 `disconnected`（popup 同步显示未连接）
- 此时划词：扩展显式提示「AGX 未运行」类通知（结果记录
  `error=nm_disconnected, notified=true`），**绝不静默吞掉**
- bridge 重启后扩展自动重连并记录新 pong（sw.js 退避上限 30s 内）
- `SIGKILL` shim 后新鲜 pong 在 30s 内出现（实测秒级）

**自动化断言（5 条）**
- J6-a desktop 停止后 storage `nm.status=disconnected`
- J6-b 此时划词 → `error=nm_disconnected` 且 `notified=true`
- J6-c desktop 重启后自动重连记录新 pong（实测 845ms ≤ 30s 退避上限）
- J6-d 自愈后 `/v1/browser/status` 重新在线
- J6-e 断链（杀 shim）后新鲜 pong（实测 1059ms ≤ 30s）

---

## 第二部分 · 需真人手动执行

> 自动化覆盖不到、必须真人点一遍的 smoke。每项给出步骤与预期，执行后打勾。

### M1 原生右键菜单与权限弹窗真体验（SP5 遗留）

**前置**：真 Google Chrome，开发者模式加载仓库 `extension/`（正式 manifest，
可选 host 权限申请制）；desktop 正常运行；任选一个你常去的网页。

**步骤**
1. 选中页面一段文字 → 右键 → 应看到 **「划词发给 AGX」** 与 **「整页发给
   AGX」** 两个菜单项（图标与文案正常）
2. 点「划词发给 AGX」→ 首次应弹 Chrome 原生权限弹窗（申请当前站点）
3. 点「允许」→ AGX 会话出现内容 + 来源标注
4. 换一个站点重复 → 权限弹窗按站点独立申请
5. 在权限弹窗点「拒绝」→ 扩展应显式提示未授权，而不是无反应
6. 右键「整页发给 AGX」→ 长文章同样应带「已裁剪」标注

**预期**：菜单文案/顺序正确；权限弹窗只列当前站点 origin；拒绝路径有反馈。

### M2 真 Google Chrome（非 Chrome for Testing）开发者模式加载（SP1 遗留）

**前置**：日常使用的真 Google Chrome（带个人 profile 与扩展生态）。

**步骤**
1. `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选仓库 `extension/`
2. 观察：扩展加载无错误（无红色 Errors 徽标），ID 与 NM host manifest 的
   `allowed_origins` 一致（不一致则 NM 会被拒）
3. 点开 popup → 应显示 connected + RTT
4. 划词一发 → AGX 会话正常收到
5. 重启 Chrome → 重复 3–4（确认冷启动自恢复）

**预期**：正式姿势（申请制 host 权限）下全链路可用。
（注意：`--load-extension` 命令行方式在品牌 Chrome 上已被禁用，此步必须用
UI 加载；这正是自动化只能用 Chrome for Testing 的原因。）

### M3 断链/杀进程真体验（SP1 遗留）

**步骤**
1. 扩展连接正常时，彻底退出 AGX desktop（托盘退出）
2. 观察 popup：约数秒内翻为 **disconnected**（灰色）+ 尝试计数增长
3. 此时刻意划词 → 应弹「AGX 未运行」类系统通知，绝不静默
4. 重新拉起 desktop → 不做任何操作，popup 应在 30s 内自动回到 connected
5. 观察「重连尝试次数」在自愈后清零/重置

### M4 敏感域与确认卡片真体验（SP4 遗留）

**前置**：AGX 里让 agent 操作浏览器；准备一个真实登录页（如任意网站的
登录表单）。

**步骤**
1. 让 agent 打开一个银行/支付站点 URL → 期望：agent 回复被拦
  （blocked: sensitive domain），浏览器无导航
2. 让 agent 在普通网页的密码框里输入内容 → 期望：页面中央弹出确认卡片
  （含动作摘要与 允许/拒绝）
3. 点「拒绝」→ agent 收到 user_declined；点「允许」→ 输入落地
4. 银行走完后查 `AGX_HOME/action_audit/outbox.jsonl` 有审计行

**预期**：卡片样式可读、阻断优先于任何执行、审计落盘。

### M5 2 小时长跑稳定性（各 SP 遗留）

**步骤**
1. 保持 desktop + 真浏览器扩展连接，正常挂机 2 小时（期间可正常用电脑）
2. 每 20 分钟左右做一轮最小动作：popup 看 RTT、划词一发
3. 结束后检查：popup 仍 connected、无 JS 报错（扩展页 Errors 徽标）、
   desktop 侧 bridge 状态在线、审计 outbox 行数合理
4. 期间观察 NM shim 进程无僵尸堆积（`pgrep -f nm-bridge-shim` 应 ≤1）

**预期**：MV3 SW 反复回收周期下心跳/重连自愈不失效，无句柄/进程泄漏。

---

## 自动化执行结果

- 脚本：`scripts/e2e/verify-user-journey.mjs`
- 环境：macOS arm64 · node v26.8.1 · Chrome for Testing（playwright
  `chromium-1234`）· 编译自 `desktop/electron`（`npx tsc -p electron/tsconfig.json`）
- 最近两次连续全量执行均 **35/35 PASS**（下表为第一轮；第二轮复跑合计
  耗时 3129ms、J5 耗时 406ms、J6 自愈 1057ms，其余同表）：

| 旅程 | 断言数 | PASS | FAIL | 耗时(ms) | NM RTT(ms) | 结果 |
|---|---|---|---|---|---|---|
| J1 首次安装与连接 | 4 | 4 | 0 | 197 | 637 | PASS |
| J2 日常划词 | 6 | 6 | 0 | 55 | 637 | PASS |
| J3 整页阅读 | 4 | 4 | 0 | 55 | 637 | PASS |
| J4 指令驱动浏览器（六 action） | 8 | 8 | 0 | 254 | 637 | PASS |
| J5 安全场景 | 8 | 8 | 0 | 238 | 637 | PASS |
| J6 异常场景 | 5 | 5 | 0 | 2150 | 53 | PASS |
| **合计** | **35** | **35** | **0** | **2949** | - | **PASS** |

- J6 实测自愈数据：desktop 重启后自愈 845ms；NM shim 被 SIGKILL 后自愈
  1059ms（预算 30s）
- 结论：J1–J6 全部 PASS，无 FAIL/静默跳过项。

### 执行备注（本仓库实测踩坑，改动需复跑）

1. **SW 冷启动不可打扰**：必须先等 bridge 侧 `extension_online=true`（零
   CDP 流量）再碰 SW；对 SW 的 DevTools 必须是**一条持久会话**
   （SP1 `createCdpSession` 模式）。每次 evaluate 新开 WebSocket 又立即关闭
   的写法会在冷启动窗口反复触发「检查器脱离即停止」，SW 死在
   `connect()`/`alarms.create` 之前且再也不唤醒。
2. **截图需要常驻授权**：六 action 的 `near_browser_screenshot` 依赖
   `captureVisibleTab`（要 `<all_urls>` 或 activeTab；自动化无手势拿不到
   activeTab），临时扩展副本按 SP3/SP4 姿势打 `<all_urls>` 常驻授权。
   —— SP6 定稿（与「生产 manifest 无常驻授权」的矛盾解法）：生产走
   `optional_host_permissions: <all_urls>` 动态申请，用户在扩展选项页「启用
   浏览器截图」一次性授权/可撤销；executor 预检 `permissions.contains`，
   无授权返回 `screenshot_permission_required`。e2e 的常驻 patch 即模拟
   「用户已在选项页开启」的安装态（见 SP6 plan §5.1）。
3. **调试端口启动有延迟**：`/json` 探测必须容错 ECONNREFUSED（浏览器拉起
   需要 1–2s），fetch 失败视为无目标下一轮再试。
4. **单浏览器单 bridge 串完六条旅程**：不要每条旅程重开浏览器，J6 的
   断链/自愈与 J2 的 tab 复用都依赖同一会话的连续状态。
5. J4/J5 的 action 全部走 bridge HTTP `POST /v1/browser/act`（agent 等效
   入口），J2/J3 用 SW 内 `agxHandleContextMenuClick` 合成菜单点击，权限
   首用分支用 `inject.js` 测试缝强制（默认值即真实 API）。
