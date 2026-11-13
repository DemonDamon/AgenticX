# AGX 浏览器插件 Master Plan（feat/agx-browser-extension）

日期：2026-11-11 · 状态：待拍板 2 个决策后进入 Phase 0

## 0. 结论摘要

- **做浏览器插件，不做 AI 浏览器，不做云端浏览器。**
- 连接拓扑选 **Native Messaging（密码管理器范式）**：Extension backend 挂在现有 bridge server 下，agent 侧零改动。
- MVP 只做：六 action 全通 + 敏感域防护/确认卡片 + 划词/整页注入 session。**不做侧边栏聊天**（P2 再议）。
- 唯一技术不确定点：MV3 Service Worker 回收下 NM 长连接的稳定性 —— Phase 0 spike 先验证，不过关降级为扩展长轮询。

## 1. 背景与立项论据

### 1.1 内部论据（最硬的一条）

`desktop/electron/chrome-cookie-import.ts` + `chrome-cookie-crypto.ts` 现状：
直接解密用户 Chrome 的 cookie 数据库，灌进 WorkPanel 分区 `persist:near-workpanel-browser`。

**结论：** "复用用户真实登录态"的需求已被产品验证，目前用最脆弱的 hack 满足
（Chrome cookie 加密格式一变即全崩，历史上有 v10→v20 密钥变更先例）。
插件不是追 Kimi 热点，是把既有的 hack 正规化成受支持的通道。

### 1.2 外部形态验证

| 产品 | 形态 | 与 AGX 的差异 |
|---|---|---|
| Kimi 浏览器扩展（原 WebBridge，2026 更名） | 本地桥接服务 + 扩展 + CDP，复用真实浏览器登录态 | 先做插件后补桌面端；AGX 反过来，协议已就绪 |
| Claude for Chrome（Anthropic） | 扩展 + 本地 orchestrator + chrome.debugger | 同形态二次验证，执行引擎选择可对标 |

两家不同体量的公司收敛到同一形态：**扩展 + 本地服务**。方向不需要再赌。

### 1.3 复用现状盘点（诚实评估：约四成）

可复用（不动）：
- `agenticx/cli/agent_tools.py` L3966-4016：`_tool_near_browser_http`，六工具语义、读 port/token 文件逻辑
- `desktop/electron/browser-bridge.ts`：`/v1/browser/act` 协议、ACTIONS 集合、pending/request_id/settle 机制
- `agenticx/tools/near_browser/url_guard.py`：私网/危险协议拦截
- `agenticx/runtime/effect_guard.py` L28：`near_browser_click/type` 已列为 guarded call
- `desktop/electron/action-audit-uploader.ts`：审计链路

不可复用（要新建）：
- **执行载体**：现有 bridge 只能驱动 Electron 内嵌 webContents，触达不了用户真实 Chrome/Edge —— 这正是本 plan 要补的缺口。

## 2. 战略定位

**一句话：插件不是 AGX 的第四个客户端，是 agent 伸进用户真实浏览器的手。desktop 是控制台，插件是肢体末端。**

三个不做：
1. **不做 AI 浏览器** —— Chromium 内核跟进是常驻发行团队的活，抢默认入口是流量公司的战争，AGX 两样都不占。
2. **不做云端浏览器** —— Operator/browser-use 已占位，且与 AGX 本地隐私、私有化部署路线相反。
3. **MVP 不做侧边栏聊天** —— AGX 用户人手一个 desktop，第二个聊天入口是伪需求。Kimi 做侧边栏是接无桌面端的轻会员，处境不同。MVP 里扩展 UI 只剩：连接状态 + 动作确认卡片。

进 MVP 的核心增量：**划词/整页注入 session** —— desktop 架构上拿不到用户正在看的页面，这是插件形态独有的价值。

## 3. 架构设计

### 3.1 连接拓扑选型

❌ 已否决：独立 helper 进程写 `~/.agenticx/browser_bridge.port`
—— desktop 与 helper 双写同一 port/token 文件，互相覆盖、token 不一致直接鉴权失败。

✅ 采用：**Native Messaging（1Password/Bitwarden 桌面版 ↔ 扩展通信范式）**
- desktop 安装时注册 NM host（macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`，Windows: 注册表）
- 扩展 `chrome.runtime.connectNative` 连回 desktop，建立双向消息管道
- bridge 收到 agent 请求 → 经 NM 转发到扩展 → 扩展执行 → NM 回包 → settle

收益：
- 不新增常驻进程/server，port/token 文件单写者，冲突消失
- agent 侧真零改动
- desktop 未运行 = 扩展显示"未连接"（与 Kimi 同 UX，AGX desktop 本来就常驻）

### 3.2 双 Backend 分发

`browser-bridge.ts` 改动收敛在执行分发层：

```
HTTP /v1/browser/act
  └─ 按 backend 路由：
     ├─ Embedded（现状）：IPC → WorkPanel renderer → webContents
     └─ Extension（新增）：NM → 扩展 → 用户 Chrome 当前 tab
```

### 3.3 执行引擎

| 场景 | 引擎 | 说明 |
|---|---|---|
| 默认 | `chrome.scripting` + `activeTab` | 过审最稳姿势，对标 Claude for Chrome |
| CSP 强站点（飞书/Notion 类） | `chrome.debugger`（CDP） | **默认关闭**，`optional_permissions` 动态申请，白名单站点引导开启 |
| screenshot | `chrome.tabs.captureVisibleTab` | 不依赖 debugger |

### 3.4 安全纵深（复用已有体系，不重复建设）

| 层 | 资产 | 状态 |
|---|---|---|
| URL 防护 | `url_guard.py` 挡私网/危险协议 | 已有（agent 侧） |
| 动作门控 | `effect_guard.py` guarded call | 已有 |
| 敏感域拦截 + 人审 | 银行/支付/邮箱/政务默认拒绝；确认 UI 在扩展内 | **新增（MVP 唯一新 UI）** |
| 审计 | 动作日志回传 action-audit-uploader，带 `source=extension` | 已有链路 + 字段 |

**关键认知：插件拿到的是用户全部站点的登录态，暴露面比 browser-use 起干净 Chromium 大得多。敏感域拦截和确认卡片是 P0，不是加分项。** 这也是 AGX 相对 Kimi 的差异点（其文档只承诺"执行在本地"）。

### 3.5 profile 语义

`near_browser/profile.py` 的 per-session profile 隔离在 Extension 模式下天然失效
（用户只有一个真实 profile）——这是目的不是缺陷，但审计与结果中必须带 `source=extension` 区分。

### 3.6 manifest 权限草案（过审姿势）

```json
{
  "permissions": ["nativeMessaging", "sidePanel", "storage", "scripting", "activeTab", "tabs", "contextMenus", "alarms"],
  "host_permissions": [],
  "optional_permissions": ["debugger"],
  "optional_host_permissions": ["<all_urls>"]
}
```

原则：不用 `<all_urls>` + `cookies` 组合（审核双杀）；用户点击才激活 optional 权限。

## 4. 分阶段计划

### Phase 0 — Spike（只验证一个技术前提）

MV3 Service Worker 回收下 NM 长连接的保活与断线自愈：
`chrome.alarms` 心跳重连、浏览器重启后自动恢复。

验收判据：
1. desktop 对用户 Chrome 当前页执行 6 个 action 全通，结果回填 Studio session
2. 断连 30 秒内自愈
3. 不满足 → 降级为扩展长轮询 bridge（成本略高，可行）

### Phase 1 — MVP

范围：
- 六 action 全通（open/snapshot/click/type/press_key/extract_text/screenshot）
- 敏感域防护 + 动作确认卡片
- 划词/整页注入当前 session（content script + contextMenus）
- Chrome Web Store + Edge Add-ons 上架

判据：near_browser_* 在 Extension backend 上的调用量持续增长；无增长即停在维护态。

### Phase 2 — 纵深（按价值排序）

1. **录制操作生成 skill** —— Kimi 也有，但其 skill 困在插件里；AGX 的 skill 进 runtime、跨端复用，是独有纵深
2. **独立 helper 模式** —— 脱离 desktop，服务 Claude Code 等三方 local agent（Kimi `install_skill.sh` 路线）
3. **企业策略分发** —— `ExtensionInstallForcelist` 私有化强推，免商店审核（政企线顺手加分）

## 5. 风险与兜底

| 风险 | 兜底 |
|---|---|
| NM 连接被 SW 回收打断 | Phase 0 先验证；不过关切长轮询 |
| `chrome.debugger` 触发审核驳回 | 默认关闭，optional 动态申请 |
| CSP/iframe 站点注入拿不到内容 | snapshot 降级 captureVisibleTab，或引导白名单站开 debugger |
| 登录态暴露面大 | 3.4 四层防护 MVP 就位 |
| 装完不用（留存） | Phase 1 后看调用量增长，无增长停在维护态 |

## 6. 改动面预估

| 模块 | 文件 | 动作 |
|---|---|---|
| desktop | `electron/browser-bridge.ts` | 加 backend 分发 + ExtensionBackend（NM 转发） |
| desktop | `electron/native-messaging-host.ts`（新） | NM host 注册/管理（安装器写入 manifest） |
| extension | `extension/`（新目录） | manifest/MV3 SW/NM 客户端/执行器/确认 UI/content script |
| agent | 无 | **零改动** |
| 测试 | `tests/` + `desktop/tests/` | backend 路由单测；spike 手动验收脚本 |

## 7. 待拍板问题

1. **侧边栏聊天砍到 P2** —— 认不认？（与初版方案的最大范围差异）
2. **分发主路径**：商店优先（C 端获客）还是企业私发优先（私有化免审核、策略强推）？决定 Phase 1 权限申请姿势与上架顺序。

## 8. 参考

- Kimi 浏览器扩展（原 WebBridge）：产品页 / 帮助中心（kimi.com/zh-cn/help/kimi-webbridge/）
- 既有 plan：`.cursor/plans/2026-09-16-near-agent-driven-workpanel-browser.plan.md`（Embedded backend 的原始设计）

## 9. Sub Plans 索引（2026-11-11 拆分，每个由独立 sub agent 执行）

| SP | 文件 | 依赖 | 闭环 |
|---|---|---|---|
| SP1 NM 通道 spike | `...-sp1-nm-channel-spike.plan.md` | 无 | NM 双向通道保活 + 断线自愈验证 |
| SP2 ExtensionBackend 桥接 | `...-sp2-extension-backend-bridge.plan.md` | SP1 | `/v1/browser/act` 双 backend 路由，stub 全链路 |
| SP3 六 action 执行器 | `...-sp3-action-executor.plan.md` | SP2 | 六 action 真实页面执行回填 session |
| SP4 安全层 | `...-sp4-safety-layer.plan.md` | SP3 | 敏感域拒绝 + 确认卡片 + 审计标记 |
| SP5 划词/整页注入 | `...-sp5-page-inject.plan.md` | SP1 | 页面上下文进 Studio session |
| SP6 打包分发收尾 | `...-sp6-package-distribution.plan.md` | SP3+SP4+SP5，且决策 #2 已拍 | manifest 定稿 + 首次交付 |

依赖图与执行组织：

```
SP1 ──┬─→ SP2 ─→ SP3 ─→ SP4 ──┐
      └─→ SP5 ────────────────┴→ SP6
```

执行约束：
- 每个 SP 一个独立 sub agent，验收判据通过后才派下一个（Phase 0/1 判据见第 4 节）
- SP1 结论若是 FAIL，回到 master plan 3.1 节做降级决策，SP2-SP6 全部暂停
- sub agent 只拿对应单份 plan + 本 master plan 3.x 节引用，防扩散边界写在每份 plan 第 0 节
- 未 commit：整个 plan 集提交随首个实现代码（SP1 产出）一起进版本库
