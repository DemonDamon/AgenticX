# AGX Web Copilot — 浏览器侧边栏就地对话（规划稿 v1）

> 承接 `.cursor/plans/2026-11-11-agx-browser-extension.plan.md`（SP1-SP6 已完成并推送）。
> 定位对齐 Kimi 的两条线合流：AGX Bridge = "给 Agent 的手"（已完成），本计划补
> "给人的侧边栏"——划词后就地看到回答，不必切窗口到桌面端。

## 0. 目标与非目标

**目标（v1）**
- 划词/点工具栏图标 → 浏览器右侧打开 AGX 侧边栏，就地对话，回答直接显示在面板内
- 复用现有全套底座：NM 通道（SP1）、桥接协议（SP2）、敏感域名拦截（SP4）、activeTab 权限姿势（SP5 修复版）
- 会话与登录态完全留在桌面端（不新建账号体系、不在浏览器存历史）

**非目标（v1，克制）**
- 不做流式输出（v2 加 `chat_delta`）、不做多轮会话切换 UI、不做历史列表
- 不做独立登录/会员体系（桌面端已管）
- 不碰企业策略逻辑（沿用 SP6 下发 + SP4 拦截层）

## 1. 核心架构决策

### 1.1 容器：chrome.sidePanel（MV3，Chrome 114+）
- 原生右侧面板，extension page（`chrome-extension://…/panel.html`），不注入页面 DOM
- **零新增 host 权限**：面板是扩展页；划词采集继续走 activeTab（SP5 修复后的语义）
- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` → 点工具栏图标即开面板

### 1.2 传输：全量复用 NM 通道
```
panel.html ──chrome.runtime.sendMessage──> SW ──NM port──> desktop bridge ──> Studio 会话
                                                        <── {type:"copilot_reply"} ──
```
- 新消息类型 `{type:"copilot_chat", request_id, session_id?, text, source_url?, source_title?}`
- 桌面端回复 `{type:"copilot_reply", request_id, session_id, ok, text|error}`（v1 非流式单轮）
- session_id 解析复用 P1 规则（`agx_active_session` 缓存 → 桌面端取最近活跃会话）

### 1.3 入口（三个，不破坏现状）
1. 工具栏图标点击 → 空面板（显示当前绑定会话名 + 输入框）
2. 右键菜单**新增**「划词问 AGX（侧边栏）」：selection 预填为第一条消息并自动发送
3. 现有「划词发给 AGX / 整页发给 AGX」**保持不变**（后台注入，向后兼容）

### 1.4 安全：不降级
- 敏感域名 deny list 对 copilot 的页面上下文采集同样生效（银行页划词 → 拒绝并提示）
- 桌面端审计日志记录 copilot 轮次（与 agent action 同一审计通道）

## 2. 最大风险与未知（诚实清单）

| 风险 | 说明 | 对策 |
|---|---|---|
| **Studio 回复触发 API** | 桥接目前只"注入用户轮"到会话；copilot 需要程序化触发一轮 agent 回复并取回文本。Studio 是否有/需要什么 API 未验证 | SP7b 先做 spike（半天级）：验证 `/api/sessions` 侧能否 POST 一轮并读回回复；不行则降级 v1 = "面板确认已注入 + 提示桌面端查看"（明示用户，不装） |
| SW 回收打断面板状态 | MV3 SW ~30s 回收，面板若依赖 SW 长驻会掉线 | 面板状态自持（chrome.storage.session）；发送走 runtime.sendMessage 短路径，NM 重连已有（SP1） |
| 回复时延不可控 | 桌面端 agent 一轮可能 >10s | v1 明示"生成中"状态 + 超时 30s 报错不静默 |

## 3. Sub-plans（最小闭环 × 3）

### SP7a — 面板壳 + 桌面端 mock 回复（纯前端 + 协议）
- `panel.html/panel.css/panel.js` + manifest `side_panel` 字段
- SW 路由 `copilot_chat` → NM；desktop bridge 侧 mock 回复（固定文案）
- e2e：面板 DOM 断言 + 消息往返 + 敏感域名拦截在面板语境生效
- 验收：点图标开面板，输入 → mock 回答显示

### SP7b — 桌面端真实回复（含 spike）
- spike：Studio 会话回复 API 验证（上表风险 #1）
- 通过 → bridge 转发一轮并回传 agent 回答；不通过 → 降级文案方案（同步告知用户决策）
- 验收：真机面板收到真实 agent 回答

### SP7c — 划词联动 + 打磨
- 「划词问 AGX（侧边栏）」菜单 → 打开面板 + 预填 + 自动发送
- 回答渲染（markdown-lite：代码块/链接/加粗）、错误态、会话名显示
- 真机验收：划词 → 面板自动出现回答；与桌面端会话记录一致

## 4. 验收口径（端到端）
1. `node scripts/e2e/verify-copilot-panel.mjs`（新）：菜单/面板/协议/安全断言全 PASS
2. 真机：划词 → 侧边栏出回答（或降级态），桌面端会话同步出现该轮
3. 权限姿势不回退：manifest 仍无常驻 host grant（T7 守护沿用）

## 5. 与 Kimi 的对照（定位校准）
- Kimi WebBridge → 更名"浏览器扩展"后加侧边栏 = "Agent 的手"叠"给人的面板"，与我们同构
- 差异保留：我们的会话/登录/审计在桌面端 Studio，浏览器侧永远只是视图与采集入口

---
*Author: Damon Li · 2026-11-12 · 待评审后拆 sub-agent 执行*
