# SP4 · 安全层（敏感域拦截 + 确认卡片 + 审计标记）

归属：feat/agx-browser-extension · Master Plan 第 3.4 节
依赖：SP3
闭环定义：敏感域默认拒绝、高危动作人审卡片、审计带 source=extension 全链路生效

## 0. 防扩散边界

- **本 SP 是 P0 安全义务，不是功能增强**：插件持有用户全部站点登录态，暴露面大于 browser-use
- 只做拦截/确认/审计三件事。**不做**：权限管理 UI 体系、企业策略下发（P2）、隐私政策文案（SP6）
- 敏感域拦截在**扩展内**执行（防御纵深最后一道，即使 agent 侧 url_guard 被绕过也拦得住）

## 1. 任务

### 1.1 敏感域默认拒绝
- `extension/src/safety/domains.ts`：内置 deny 清单（银行/支付/邮箱/政务/社保类域名 pattern，
  从公开类别表初始化，约 20 条），匹配 `url.hostname`
- `preActionHook`（SP3 预留点）实现：target 或当前 tab 命中 deny → 直接返回
  `{ok:false, error:"blocked: sensitive domain", domain}`，不执行
- allow 解除：仅通过扩展 options 页显式确认某域名（写 `chrome.storage.local`），不提供全局关闭

### 1.2 高危动作确认卡片
- 触发条件（克制，只列这三条）：
  a) `type` 的目标是 `input[type=password]`
  b) `click` 的目标是 form submit 类按钮（type=submit 或表单内 button）
  c) `press_key` 为 Enter 且焦点在表单内
- 实现：`chrome.scripting` 注入 shadow-DOM 卡片（隔离站点 CSS），显示 action 摘要 + 放行/拒绝，
  30s 无响应视为拒绝；放行后 action 继续，结果里带 `confirmed:true`
- desktop 端不重复实现确认（effect_guard 的 guarded call 流程不变，两级各自独立生效）

### 1.3 审计
- 扩展回包与 nm-socket-server 转发路径增加 `source:"extension"`、`tab_url` 字段
- 接入 `desktop/electron/action-audit-uploader.ts` 既有上传链路：确认该 uploader 的消费格式后
  在 browser-bridge settle 处挂日志（不新建审计文件/通道）
- 拦截与确认事件本身也记录（action=blocked / confirmed）

## 2. 验收判据

1. 对内置清单中的银行站执行 click → 返回 blocked 错误，desktop 日志可见拦截记录
2. 对测试页 password 输入 type → 卡片出现；拒绝 → action 不执行；放行 → 执行且 confirmed:true
3. options 页放行某域名后，该域名不再被拦截且记录在案
4. action-audit 上传记录含 source=extension 与 tab_url
5. 全部测试绿

## 3. Sub agent 执行提示

- 先读：master plan 3.4 节、SP3 的 preActionHook 调用点与 executor 结构
- url_guard（agent 侧）已存在——**不要在扩展里复制它的私网拦截逻辑**，扩展只负责域名类别
- 卡片 UI 用 shadow DOM，禁止污染/读取站点 DOM 之外的任何内容

## 5. 执行结果

**日期**：2026-11-11 · 分支 feat/agx-browser-extension · 全判据 PASS

### 5.1 改动面

| 文件 | 内容 |
| --- | --- |
| `extension/src/safety/domains.js`（新） | 24 条内置 deny pattern（banking/payment/mail/gov 四类，含 gov.cn 整类），`agxMatchSensitiveDomain` 精确/父域匹配；allow list 存 `chrome.storage.local["agx_safety_allow"]`（{hostname: ts}，仅 options 页写入，无全局关闭）；尾部 module.exports 钩子供 node 单测 |
| `extension/src/safety/confirm.js`（新） | 三条触发判定（type→is_password、click→button 且 in_form/submit、press_key Enter→注入探测 activeElement 在表单内）；`agxPageConfirmCard` 自包含注入函数——open shadow root 固定挂载卡片 + 30s 倒计时，Promise settle {decision}；注入失败视为拒绝（"确认无法展示绝不自动放行"） |
| `extension/src/executor/index.js` | `preActionHook` 实装：非 open 动作取 active tab URL；敏感域 verdict → `{block, error:"blocked: sensitive domain", domain, category, tab_url, blocked:true}`；确认卡 allow → verdict `{confirmed:true}` 在 dispatch 结果上 merge `confirmed:true`；deny/timeout → `{block, error:"user_declined", confirm_outcome}`；switch 重构为 `dispatchAction`（语义未变） |
| `extension/src/executor/collector.js` | element 增 `in_form` 字段（SP3 snapshot 契约加法扩展） |
| `extension/src/sw.js` | importScripts safety 模块；`act_result` 一律补 `source:"extension"` + `tab_url`（缺省取结果 url） |
| `extension/options.html` + `extension/src/options.js`（新） | 最小放行管理：输入域名→放行（记录在案）→列表+撤销；只读展示内置清单；storage.onChanged 实时刷新；页内无 form（避免自家确认逻辑） |
| `extension/manifest.json` | 增 `options_ui`；权限不变（tabs/scripting/activeTab 已有，host_permissions 保持 []） |
| `desktop/electron/browser-bridge.ts` | ① NM `onActResult` settle 前保证 `source:"extension"`/`tab_url` 缺省（旧 SW 兼容）② extension 分支 act 完成（含 timeout/offline）后 `emitBrowserActionAudit`：按 action-audit-uploader 既有 v:1 JSONL 格式 append `AGX_HOME/action_audit/outbox.jsonl`（kind=browser_action、tool_name=near_browser_*、outcome=blocked/confirmed/declined/timeout/error/completed、risk、args_digest sha256、source=extension、tab_url、event_id 唯一）③ emit gate 对齐 Python `audit_enabled()`（config.yaml enterprise.enabled+token），js-yaml 解析，失败静默（审计绝不打断 bridge） |
| `desktop/tests/browser-bridge-safety-audit.test.ts`（新） | 3 用例：completed 行字段齐全 / blocked+confirmed 行 risk=high / timeout 记录 + gate 关时零写入、开时补记 |
| `scripts/e2e/fixtures/safety-page.html`（新） | 安全层测试 fixture：password 框、form（submit+in-form 按钮）、form 外按钮、焦点 helper、主世界"用户"钩子（点入卡片 shadow DOM）、MutationObserver 计卡片出现次数 |
| `scripts/e2e/verify-safety-layer.mjs`（新） | SP3 harness 模式 + 判据 T1-T14（见 5.2） |

### 5.2 判据逐项（scripts/e2e/verify-safety-layer.mjs，RESULT: PASS）

1. **PASS — deny 清单拦截**：T1 pattern 匹配 11 用例（含 fake-icbc 不误伤、icbc.com.cn.evil.com 不绕过）+ T2 `open` 银行 URL → `{ok:false, error:"blocked: sensitive domain", domain:"www.icbc.com.cn", blocked:true}`（verdict 先于 tabs.create，无需真实域名可达）+ T3 active tab 为 mail.qq.com（host-resolver-rules 映射 fixture）时 snapshot 同样 blocked；desktop 侧审计行 outcome=blocked 带 domain tab_url
2. **PASS — 确认卡片**：T5 password type→卡片（MutationObserver 计数）→拒绝→`user_declined` 且页面未动；T6→放行→执行且 `confirmed:true`；T7/T8 submit click 拒/放；T9 form 内普通按钮也触发；T10 form 外按钮直接执行（无卡片）；T11 Enter 焦点在表单内→卡片→放行→confirmed；T12 焦点在 body→直接执行
3. **PASS — options 放行**：T13 open options（chrome-extension:// 不在清单）→ CDP DevTools 驱动真实 UI 输入 mail.qq.com+点"放行该域名"→ status"已放行…（记录在案）"+列表可见 → 同域名 open/snapshot 不再拦截
4. **PASS — 审计标记**：T14 outbox 44 行全部 `source:"extension"`+`tab_url` 字段（非 error 行全部非空），outcomes {blocked:2, completed:36, declined:3, confirmed:3}，event_id 唯一，v:1/near_browser_* 契约完整；vitest 3 用例覆盖 gate 与字段
5. **PASS — 回归全绿**：SP3 verify-action-executor 26/26；desktop vitest **292/292**（基线 289+新增 3）；tsc --noEmit 0 错；扩展 JS node --check 全过

### 5.3 Findings

1. **plan 中 `domains.ts` 落地为 `domains.js`**：扩展是 classic scripts+importScripts 无构建工具链（SP1/SP2/SP3 约定），.ts 无法被 Chrome 直接加载；node 单测经文件尾部 module.exports 钩子达成同等"单测级验证"
2. **SP3 遗留-1（确认卡片生产姿势）**：卡片注入依赖 chrome.scripting 对目标页的 host 权限——生产 manifest 无 host 权限时需用户先激活扩展（activeTab 手势）才可注入页面；e2e 在临时副本 patch `<all_urls>` 验证全链路（store 姿势未破坏）。真实使用中"agent 触发卡片"时 activeTab 是否已在手，需 SP5/SP6 联调确认；兜底语义已实现：注入失败=拒绝执行
3. **SP3 遗留-2（语义定稿）**：人审拒绝返回 `error:"user_declined"`（区别于 effect_guard 的 human_takeover——用户明确说"不"），`confirm_outcome:"deny"|"deny_timeout"`；审计 outcome=declined
4. **卡片 30s > bridge timeout 20s**（click/type/press_key）：用户 20s 后响应时 bridge 已回 timeout，晚到的 act_result settle 为 no-op（卡片已自清理、无副作用）；如需"完整 30s 人审窗口"需对确认路径调整 bridge 预算——留给后续 SP
5. **e2e 环境坑**：① chrome.scripting 硬性禁止注入 chrome-extension:// 页面（有 host grant 也不行）→ options UI 测试走 CDP DevTools（node≥22 原生 WebSocket），产品无测试后门 ② 开发机系统代理（127.0.0.1:7897）会绕过 --host-resolver-rules → e2e Chrome 加 `--no-proxy-server` ③ 多启动 URL 的 active tab 不可靠 → mail tab 作为唯一启动 tab
6. **审计行扩展字段**：uploader（TS 侧 flush）对行内容 JSON.parse 后原样上传，不做白名单过滤——desktop emit 的行天然带 source/tab_url 透传到企业；Python 侧 emit 的行仍是其白名单格式，两者混在同一 outbox 均可上传

### 5.4 遗留（后续 SP / 手工项）

- 用户在卡片上 20s 后响应的 bridge 预算调优（见 5.3-4）
- options 页允许列表的批量管理/导入导出：非本 SP 范围（防扩散），如企业侧需要走 SP6+ 策略
- 真实 deny 域名（如 https://www.icbc.com.cn）的线上手工冒烟：自动化以 verdict 语义覆盖，未访问真实银行站
- desktop emit 的审计行 `agent_id` 暂空（bridge 无 agent 上下文）；session_id 已带
