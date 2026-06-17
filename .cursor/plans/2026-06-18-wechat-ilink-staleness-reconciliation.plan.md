---
name: WeChat iLink 连接时效性与状态回收对齐
overview: |
  解决微信 iLink 绑定后，凭证（token）已过期/连接已断，但 Desktop 设置面板仍长期显示「已连接」或「已绑定（未连接）」的僵尸状态问题。
  通过凭证保存时间 + 实时健康探活 + 错误驱动状态回收 + Desktop 侧防御性对齐，实现“绑定记录”与“实际可用性”的一致呈现。
todos:
  - id: problem-analysis
    content: 梳理当前状态机、sidecar /status 行为、monitor 错误处理、binding vs credentials 职责
    status: completed
  - id: design
    content: 设计分层状态模型（has_binding / has_creds / monitor_healthy / stale_reason）与回收策略
    status: completed
  - id: sidecar-cred-timestamp
    content: Credentials 结构体增加 saved_at / last_success_at；save 时写入；/status 返回年龄与健康标记
    status: completed
  - id: sidecar-error-handling
    content: OnError 连续失败后降级 monitorRunning + 广播 stale 事件；启动时 probe 轻量验证
    status: completed
  - id: sidecar-status-api
    content: 增强 /status 返回字段：connected, bot_id, status, stale, credential_age_hours, last_success_at, last_error
    status: completed
  - id: desktop-state-machine
    content: 扩展 wechatStatus 状态（增加 stale / needs_reconnect）；打开设置 + 周期轮询 + SSE 错误时做回收对比
    status: completed
  - id: desktop-binding-staleness
    content: 读取 wechat_binding.json 的 bound_at + credentials saved_at，做 20h+ 防御性降级为 expired/stale
    status: completed
  - id: desktop-reconnect-ux
    content: 为 stale/expired 状态提供「尝试恢复」「重新绑定」清晰操作；解绑同时清理两份文件
    status: completed
  - id: adapter-side
    content: WeChatILinkAdapter 消费 sidecar 错误事件，必要时暂停消费或提示；记录 last_event_at
    status: completed
  - id: ui-copy
    content: 文案区分「已连接」「已绑定（连接中断）」「凭证已过期」；颜色与操作一致
    status: completed
  - id: verification
    content: 冒烟：过期凭证启动 → 设置页显示 stale/expired；新绑定成功；monitor 真连通时显示 connected；解绑彻底
    status: completed
isProject: false
---

# WeChat iLink 连接时效性与状态回收对齐

## What & Why

用户扫码绑定个人微信后，iLink 的 bot_token / context_token 有效期较短（设计上「24 小时未活跃即过期」）。当前实现存在以下断层：

- Sidecar 仅凭 `wechat_credentials.json` 存在 + 内存 `monitorRunning` 标志就报 `connected: true` 或带 `bot_id`。
- `OnError`（包括 `getUpdates ... EOF`）只打日志 + 发 `type:error` SSE，**不清除** `monitorRunning`。
- 只有 `OnSessionExpired` 才会把 `monitorRunning = false` 并广播 `session_expired`。
- Desktop 只在打开「设置」面板时采样一次 `/status`，之后完全相信快照。
- `wechat_binding.json` 里的 `bound_at`（_desktop）从未参与时效判断。
- `wechat_credentials.json` 本身不带任何时间戳。

结果：凭证早已失效，monitor 早已 EOF，但 UI 仍显示绿点「已连接」+ Bot ID，用户看到“解绑”按钮却不知道通道已经死了（僵尸绑定）。

本计划的目标是**彻底对齐**“绑定记录存在”与“实际可用性”，让状态机诚实、可恢复、可观测。

## 现状 vs 期望

### 当前状态机（SettingsPanel）
- `idle` + 无 bot_id：从未绑定
- `binding`：扫码中
- `connected`：sidecar 报 connected
- `idle` + 有 bot_id：有凭证但 sidecar 报未 connected（“已绑定（未连接）”）
- `expired`：仅当 sidecar 主动推 `session_expired`
- `error`

### 期望分层状态（推荐）
1. **has_desktop_binding**（来自 wechat_binding.json `_desktop`）
2. **has_valid_creds**（文件存在 + bot_token 非空 + saved_at 未超龄）
3. **monitor_healthy**（sidecar 内存 + 最近成功心跳/消息）
4. **stale_reason**（expired / network_error / credential_too_old / probe_failed）

UI 最终呈现：
- 未绑定
- 已绑定（凭证健康但 monitor 未跑）
- 已连接（monitor 真在跑且近期成功）
- 已过期 / 连接失效（可恢复或需重绑）
- 错误

## Requirements

### FR-1: 凭证带时效信息
- FR-1.1: `Credentials` 结构体新增 `SavedAt string`（ISO8601）。
- FR-1.2: `saveCredentials` 时写入当前时间。
- FR-1.3: `loadCredentials` 成功后返回年龄信息（或让调用方计算）。

### FR-2: Sidecar /status 诚实汇报健康度
- FR-2.1: 返回新增字段：
  - `stale: bool`
  - `credential_age_hours: number`
  - `last_success_at?: string`
  - `last_error?: string`
  - `status`: "connected" | "idle" | "stale" | "expired" | "disconnected"
- FR-2.2: 启动时若有旧凭证，先做轻量 probe（或在第一次 Monitor 失败后快速标记）。
- FR-2.3: `OnError` 连续失败（例如 3 次内）后把 `monitorRunning` 置 false 并广播 `{"type":"status","status":"stale"}`。

### FR-3: 错误与过期路径一致回收
- FR-3.1: 保留并强化 `OnSessionExpired` → `session_expired`。
- FR-3.2: 普通网络错误达到阈值也进入 stale 路径（不直接等 22h keepalive）。
- FR-3.3: `/reconnect` 端点在失败时也返回明确错误，便于上层判断。

### FR-4: Desktop 主动回收对比（防御 + 主动）
- FR-4.1: 打开设置面板时：
  - 读 binding 的 `bound_at`
  - 读 credentials 的 `saved_at`
  - 调 sidecar `/status`
  - 三者对齐后决定最终 `wechatStatus`
- FR-4.2: 增加轻量周期轮询（设置面板打开期间 30s~60s 一次，或全局后台轻探）。
- FR-4.3: 通过 SSE 收到 `error` / `stale` 事件时立即刷新状态。
- FR-4.4: 超过 20~22 小时的凭证，即使 sidecar 报 connected，也强制降级为 `expired` 或 `stale`。

### FR-5: UI/UX 清晰呈现与恢复
- FR-5.1: 新增或细化状态：
  - `stale`（黄/橙 + “连接已失效，可尝试恢复”）
  - `expired`（红 + “凭证已过期，请重新绑定”）
- FR-5.2: 提供「尝试重新连接」（调 `/reconnect`）和「重新扫码绑定」两个动作。
- FR-5.3: 解绑时同时清理 `wechat_credentials.json` + `_desktop` binding（或至少让用户明确知道后果）。

### FR-6: 后端适配器可见性
- FR-6.1: `WeChatILinkAdapter` 监听 sidecar SSE 的 error/stale 事件。
- FR-6.2: 必要时暂停消费或在日志里标记“当前微信通道不可用”。

### NFR-1
- NFR-1.1: 状态变化必须在用户打开设置面板时**立即可见**（乐观 + 采样）。
- NFR-1.2: 不增加明显启动延迟（probe 必须轻量、有超时）。
- NFR-1.3: 向后兼容旧凭证文件（无 saved_at 时按文件 mtime 或保守策略处理）。
- NFR-1.4: 错误日志收敛，避免每次 dev 启动刷屏（降级为 warn + 限频）。

## Design Notes

### 分层职责
- `wechat_credentials.json`：iLink 身份（可有时效）。
- `wechat_binding.json`：Desktop 会话路由 + 模型偏好（`bound_at` 主要用于“这个微信号绑过哪个会话”）。
- Sidecar 内存：实时 monitor 健康。
- Desktop：最终真相合成器（对三者做回收对比）。

### 回收触发点（推荐优先级）
1. 用户打开设置面板（必须）
2. Sidecar 启动后首次 probe / monitor 失败（推荐）
3. SSE 收到 error / stale 事件
4. 定时轻探（设置面板期间）
5. 用户主动点「尝试恢复」

### 保守阈值
- 凭证年龄 > 20h → 视为高概率过期，优先展示 stale/expired。
- Monitor 连续错误 3 次内或 5 分钟无成功消息 → 进入 stale。

## Implementation Breakdown

### Phase 1: Sidecar 基础能力（Go）
1. 修改 `Credentials` + `saveCredentials` 写入 `saved_at`。
2. `handleStatus` 增强返回字段（计算 age、stale 标记）。
3. `startMonitor` 入口增加轻量探活或快速失败标记逻辑。
4. `OnError` 增加失败计数器，达到阈值后 `monitorRunning=false` + 广播 stale。
5. 启动日志对“旧凭证自动启动 monitor”给出明确提示。

### Phase 2: Desktop 状态合成与轮询
1. 扩展 `wechatStatus` 类型，增加 `stale`。
2. 抽取/新增 `refreshWechatStatus()` 函数，集中做 binding + credentials + /status 三源对齐。
3. 设置面板 useEffect 中调用，并增加定时器（仅面板打开时）。
4. 监听 sidecar SSE（如果已有通道）或通过 IPC 暴露错误事件。
5. 绑定/解绑流程中同步更新状态。

### Phase 3: UX 文案与操作
1. 根据状态渲染不同提示 + 按钮（恢复 / 重绑 / 解绑）。
2. 解绑时调用 `/unbind` 后清理本地 binding。
3. 可选：在顶栏或历史面板增加微信通道健康指示（低优先）。

### Phase 4: 后端适配器与可观测性
1. `WeChatILinkAdapter` 记录最后成功事件时间。
2. 消费到 stale/error 时记录日志并可选短暂停消费循环。
3. 考虑暴露 `/api/wechat/status`（可选，供诊断）。

### Phase 5: 验证 & 文档
- 手动场景：
  - 旧过期凭证启动 → 设置页显示 stale/expired + 恢复按钮可用。
  - 新扫码绑定 → 正确走到 connected。
  - 运行中 token 失效（模拟）→ 快速降级。
  - 解绑后两文件被清理，状态回 idle。
- 更新 AGENTS.md / 相关注释。
- 如有必要，补充简短的测试脚本（go test 或 playwright 片段）。

## Affected Files (预计)

**Sidecar**
- `packaging/wechat-sidecar/credentials.go`
- `packaging/wechat-sidecar/main.go`
- `packaging/wechat-sidecar/monitor.go`

**Desktop**
- `desktop/electron/main.ts`（IPC 如有需要暴露更多信息）
- `desktop/src/components/SettingsPanel.tsx`
- 可能轻改 `desktop/src/components/ChatPane.tsx`（如果需要把 stale 信息透给会话层）

**Adapter**
- `agenticx/gateway/adapters/wechat_ilink.py`（可选增强日志与暂停逻辑）

**其他**
- `.cursor/plans/2026-06-18-wechat-ilink-staleness-reconciliation.plan.md`（本文）
- 可能更新 `AGENTS.md` 中的微信集成描述

## Verification Plan

1. **功能回归**：原有绑定 → 收发消息流程仍通（用新凭证）。
2. **时效场景**：
   - 把 `saved_at` 改成 30 小时前 → 启动后设置页必须显示非 connected 的过期态。
   - 删除 credentials → 必须显示未绑定。
3. **错误恢复**：
   - Monitor 启动后立即 mock EOF → 状态进入 stale 并可通过「尝试恢复」再次启动。
4. **UI 一致性**：打开/关闭设置面板、切换 Tab 后状态不漂移。
5. **日志噪音**：dev 启动时不再刷 `monitor error`（或明显收敛为单条 warn）。

## Risks & Mitigations

- 风险：旧凭证文件无 `saved_at`，首次加载时年龄未知。
  - 缓解：无时间戳时使用文件 mtime，或保守按“idle + 提示用户验证”处理。
- 风险：频繁 probe 增加微信服务器压力或触发风控。
  - 缓解：探活极轻（只看 /status 或极少量 getUpdates），加客户端节流 + 指数退避。
- 风险：用户误解“stale”与“expired”的区别。
  - 缓解：文案 + tooltip 清晰解释；提供一键恢复入口。

## Out of Scope (本计划暂不做)

- 完整的 iLink token 续期自动流程（需要上游 SDK 能力）。
- 微信通道的端到端自动化测试套件。
- 把微信健康状态暴露到顶栏 badge（可后续单独计划）。
- 凭证加密增强（当前已是 0600 + 明文 token，属于历史设计）。

## 后续演进建议

- Sidecar 启动时若检测到 stale 凭证，默认**不自动起 monitor**，而是进入 idle+stale，等待用户显式恢复。
- 考虑在 `~/.agenticx/wechat_credentials.json` 增加 `last_verified_at`，每次 probe 成功更新。
- Desktop 可把当前微信通道健康通过全局 store 暴露给其他组件（ChatPane 右上角小指示等）。

---

**Plan-Id**: 2026-06-18-wechat-ilink-staleness-reconciliation  
**Plan-File**: .cursor/plans/2026-06-18-wechat-ilink-staleness-reconciliation.plan.md

Made-with: Damon Li
