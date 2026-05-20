---
name: machi-unattended-continuation
overview: 把续跑决策从 Desktop 前端定时器收敛到后端统一 API + 常驻 Supervisor，让长任务在 interrupted/exhausted/压缩后也能在 UI 离线时自动推进，并通过硬上限与完成门禁防止死循环
todos:
  - id: p0-continue-api
    content: "P0: 新增 POST /api/sessions/{id}/continue 统一续跑入口（reason + suppress_user_echo），消除前端假用户气泡"
    status: completed
  - id: p0-desktop-route-to-api
    content: "P0: Desktop resumeCurrentTask / auto-nudge 全部改调 continue API；StallRecoveryCard 与手动恢复共用同一通道"
    status: completed
  - id: p0-extend-auto-nudge-triggers
    content: "P0: auto-nudge 触发条件扩展到 interrupted + 通道 C（无 final 收尾），仍受 max_per_session 限制；前端文案明确「自动续跑」语义"
    status: completed
  - id: p1-session-supervisor
    content: "P1: agx serve 内挂 SessionSupervisor 常驻轮询，UI 离线时也能续跑；配置写入 runtime.unattended.*"
    status: completed
  - id: p1-hard-limits
    content: "P1: 硬上限 max_continuations_per_session / max_wall_clock_hours / token budget，超限置 failed 并写摘要"
    status: completed
  - id: p1-completion-gate-todos
    content: "P1: 完成门禁（仅 todo 维度）：todo_write 全部 completed/cancelled 视为达成，避免 Supervisor 反复 nudge 已完成会话"
    status: completed
  - id: p2-desktop-unattended-ui
    content: "P2: Desktop 顶栏状态 chip 展示续跑次数/剩余配额；设置面板新增「无人值守完成任务」总开关与策略"
    status: completed
isProject: false
---

# Machi 无人值守续跑闭环

- **Plan-Id**: 2026-05-20-machi-unattended-continuation
- **Owner**: Damon Li
- **Status**: Draft
- **Created**: 2026-05-20
- **前置 plan**:
  - `.cursor/plans/2026-05-19-machi-task-stall-recovery.plan.md`（前端三通道 stall + 手动恢复卡片已落地，本 plan 在其基础上做"后端化 + 统一通道"）
  - `.cursor/plans/2026-04-16-agent-heartbeat-recovery.plan.md`（P2 auto_resume_on_exhaustion 配置已存在，但仍在前端定时器触发）
  - `.cursor/plans/2026-05-18-long-task-recovery-gates.plan.md`（paused / rate-limit / 产物门禁已落地，可被 Supervisor 复用）
- **明确 Non-goals**:
  - 不做 Goal 自检与偏航检测（另立 P2 plan）
  - 不让 `LongRunOrchestrator` 接管常规聊天 session
  - 不为无人值守做专属危险工具白名单（沿用现有权限/Run Everything 策略）
  - 不做多模型自动降级（StallRecoveryCard 的"换模型继续"仍走手动路径）

---

## 1. 问题背景

用户在长任务（如 PyO3 hybrid 架构生成、deep research 等）中反复反馈两个体验断层：

1. **「开了自动续跑仍要手点」**：现有 `stall_auto_nudge_enabled` 只在 `stallState === "stall" && execution_state === "running"` 同时满足时触发；一旦走到 `interrupted`（LLM 心跳超时、上下文压缩后 SSE 断流、通道 C 兜底）就只能弹手动卡片，用户点了「恢复执行」才能继续。
2. **「点确认后出现一条用户气泡」**：`resumeCurrentTask` 调的是普通 `sendChat(prompt)`，没有 `suppressUserEcho: true`，固定话术 `"上一次任务被中断，请从未完成的 todo 项继续，并更新 todo_write 状态。"` 会被渲染成用户消息，用户感觉「被代替发了一条话」。

更根本的限制：现有所有续跑逻辑都在 Desktop 前端定时器里跑，**关窗 / 切走 / SSE 永久断开后没人触发**，谈不上"无人值守"。

## 2. 现状盘点（代码事实）

| 能力 | 代码位置 | 现状 | 缺口 |
|------|----------|------|------|
| 手动恢复 | `desktop/src/components/ChatPane.tsx` `resumeCurrentTask` | `sendChat(prompt)` 裸发话术 | 显示用户气泡；无 supervisor 接管 |
| 自动 nudge | `ChatPane.tsx` useEffect (stallState/auto-nudge) | `setForwardAutoReply` + `suppressUserEcho: true` | 仅 `running` 触发；前端 only |
| 续跑话术 | `ChatPane.tsx:4101-4107` | 三段固定文案（exhausted / interrupted / 其他） | 没有统一标识 `metadata.source` |
| 后端 execution_state | `agenticx/studio/server.py` `_resolve_chat_end_execution_state` | 区分 idle / interrupted / running | 无 supervisor 订阅 |
| 配置项 | `runtime.stall_auto_nudge_*`、`runtime.max_tool_rounds`、`runtime.auto_resume_on_exhaustion`（P2 plan 中已规划） | 散在多处 | 需统一到 `runtime.unattended.*` 命名空间，但保留向后兼容 |
| 长任务编排 | `agenticx/longrun/orchestrator.py` | 独立 task workspace + stall + retry | 与聊天 session 解耦，本 plan 复用其 stall/retry 思路，不让它接管聊天 |

## 3. 目标架构

```
Desktop (online)             agx serve (always-on)               Agent Runtime
   │                                │                                  │
   │ 1. user 下达目标               │                                  │
   ├──────────────────────────────►│   chat SSE                       │
   │                                ├─────────────────────────────────►│
   │                                │                                  │
   │ 3. UI 上的「恢复」/ auto-nudge │  Supervisor 周期轮询             │
   ├─────► POST /continue ────────►│◄──── execution_state poll ──────┤
   │                                │                                  │
   │                                │  4. Supervisor 也调 /continue   │
   │                                ├─────────► run_turn ─────────────►│
   │                                │                                  │
   │                                │  5. 硬上限 / 完成门禁           │
   │                                │     done / failed + summary     │
```

核心：**Desktop 与 Supervisor 都走同一个 `/continue` 端点**，行为完全一致；Supervisor 只是「关窗时仍在的那个客户端」。

## 4. Requirements

### FR-1 统一续跑 API（P0）

新增 `POST /api/sessions/{session_id}/continue`：

- Body:
  ```json
  {
    "reason": "stall" | "interrupted" | "exhausted" | "rate_limit" | "manual",
    "suppress_user_echo": true,
    "source": "desktop_manual" | "desktop_auto_nudge" | "supervisor"
  }
  ```
- 内部按 `reason` 选话术（沿用 `ChatPane.tsx:4101-4107` 三段，集中到 `agenticx/studio/continuation.py`）。
- 写入 `chat_history` 时 `metadata.source = <source>`、`metadata.reason = <reason>`、`metadata.continuation_round = N`。
- 复用现有 `/api/chat` 流式管线（`_event_stream`），返回 SSE。
- 鉴权与 `/api/chat` 一致（`X-AGX-Desktop-Token`）。

**AC-1.1** 同一 session 连续 2 次 `/continue` 不会重复创建 user 消息记录，仅追加 `metadata.source = supervisor_nudge / desktop_auto_nudge` 的系统 continuation 行。  
**AC-1.2** Desktop 端 SSE 与 `/api/chat` 体验一致（流式、可中断、token_usage 计入会话）。

### FR-2 Desktop 收敛到 API（P0）

- `resumeCurrentTask`（`ChatPane.tsx` + `ChatView.tsx`）改调 `/continue`，不再 `sendChat(prompt)`。
- auto-nudge useEffect 同样改调 `/continue`，不再走 `setForwardAutoReply`（保留 store API 兼容群聊与定时任务，但 stall 路径不用）。
- StallRecoveryCard「恢复执行」点击 → `/continue?reason=stall|interrupted|exhausted`，根据 `stallState` + `execution_state` 推断 reason。
- 渲染：`metadata.source` 非空的消息以 tool/系统行样式渲染，**不**显示为用户蓝色气泡。

**AC-2.1** 任何续跑路径都不再产生「上一次任务被中断…」的用户气泡；改为一条灰色系统行 `🔁 自动续跑 · 原因：中断`。  
**AC-2.2** 手动「恢复执行」与自动续跑视觉上有清晰区别（手动可保留主按钮反馈；自动加 `🔔` 前缀）。  
**AC-2.3** 不破坏现有 paused / exhausted 卡片的「换模型继续」「调整上限」按钮。

### FR-3 auto-nudge 触发条件扩展（P0）

- 触发条件由当前 `stallState === "stall" && execution_state === "running"` 改为：
  - `stallState === "stall"` **且** `execution_state ∈ { running, interrupted }`
  - **或** 通道 C 命中（idle 但无 final 收尾，已在 `task-stall-policy.ts` 实现）
- 仍受 `stall_auto_nudge_after_seconds` 与 `stall_auto_nudge_max_per_session` 限制。
- `interrupted` 触发时 reason = `"interrupted"`；通道 C 触发时 reason = `"stall"`。

**AC-3.1** 用户场景（上下文压缩 → 通道 C → interrupted）下，开启自动续跑后不再需要手点即可继续。  
**AC-3.2** 达到 `max_per_session` 后 StallRecoveryCard 显示「已自动续跑 N 次，请改为手动操作」（现有 UI 已支持）。

### FR-4 SessionSupervisor（P1）

- 新增 `agenticx/studio/supervisor.py`：FastAPI startup 注册一个 asyncio 常驻任务。
- 行为：
  - 每 30s 扫描 `SessionManager.list_sessions()` 中 `metadata.unattended_enabled === True` 的会话；
  - 对每个目标会话调用与 Desktop 相同的判定（沿用 `task-stall-policy` 的 Python 等价实现，集中到 `agenticx/runtime/stall_policy.py`）；
  - 命中则 POST 内部 `/continue`（或直接调内部函数），`source = "supervisor"`；
  - 受 `runtime.unattended.max_continuations_per_session` 与 `max_wall_clock_hours` 限制；
  - 超限时调用 `manager.set_execution_state(sid, "failed")`，写 summary 到 `messages.json`。
- 仅当用户在该会话**显式启用无人值守**时才接管（默认关，避免误触发计费）。

**AC-4.1** 关闭 Desktop 30 分钟后，启用无人值守的会话仍可观察到 supervisor 续跑痕迹（消息流 + log）。  
**AC-4.2** Supervisor 不会对未启用无人值守的会话发任何续跑。  
**AC-4.3** Supervisor 进程崩溃/重启后，依据 `messages.json` 与 `execution_state` 恢复轮询，不重复 nudge 同一轮。

### FR-5 硬上限与失败收敛（P1）

- 配置（`~/.agenticx/config.yaml`）：
  ```yaml
  runtime:
    unattended:
      enabled: false                          # 全局默认关
      max_continuations_per_session: 20
      max_wall_clock_hours: 6
      stall_continue_after_seconds: 120
      auto_resume_exhausted: true
      auto_resume_interrupted: true
      rate_limit_backoff_seconds: [60, 120, 300]
  ```
- 单会话开关：`session.metadata.unattended_enabled`，由 Desktop UI 写入。
- 超过任一硬上限：
  - 写一条系统消息：`⛔ 无人值守已停止：达到 max_continuations_per_session=20`
  - `execution_state` 置 `failed`，`failure_reason` 写入 metadata；
  - Desktop 端再次进入该会话能看到清晰的失败摘要。

**AC-5.1** 设 `max_continuations_per_session=3` 跑一个故意死循环任务，Supervisor 在第 4 次前停止并写入 failed。  
**AC-5.2** rate limit 路径走指数退避而非线性 nudge。

### FR-6 完成门禁（todo 维度，P1）

- Supervisor 在每次决定 nudge 前先看最近一次 `todo_write` 的结果：
  - 若全部 `completed` 或 `cancelled` → 视为 `done`，写一条 `✅ 任务已完成` 系统消息，停止继续 nudge；
  - 若无 `todo_write` 历史 → 沿用 stall 判定逻辑；
  - 若仍有 `in_progress` / `pending` → 继续按策略 nudge。
- 不做产物门禁（沿用现有 `long-task-recovery-gates` 路径）。
- 不做 Goal 自检（P2）。

**AC-6.1** 所有 todo completed 的会话不会被 Supervisor 反复 nudge。  
**AC-6.2** 无 todo 体系的会话不会因为缺 todo 而被误判为已完成。

### FR-7 Desktop 状态可见性（P2）

- 顶栏或输入区上方加一个 chip：`无人值守 · 续跑 3/20 · 剩余 todo 2`（仅 unattended_enabled 时显示）。
- 设置面板 Automation Tab 新增「无人值守完成任务」分区：
  - 全局开关 `runtime.unattended.enabled`
  - 硬上限数值
  - 文案明确：「**仅**在你打开无人值守的会话生效；不会替你回答任何新问题」
- 与现有「自动续跑」分区共存；后者文案补一句「（前端在线时使用；无人值守模式由 Supervisor 接管）」。

**AC-7.1** 用户能在不读代码的情况下从设置面板看懂两个开关的边界。  
**AC-7.2** 顶栏 chip 实时反映续跑次数；超限后显示 `已停止 · 达到上限`。

## 5. Non-Goals（再次明确）

- Goal Anchor 偏航检测（参见 `2026-05-11-long-horizon-goal-anchor.plan.md`，本 plan 不动）。
- `LongRunOrchestrator` 接管常规聊天 session（架构耦合过深，另立 plan）。
- 多模型自动降级、危险工具白名单（超出本 plan 边界）。
- 改造 `automation:*` 定时任务路径（与无人值守语义不同，定时任务每次新 session）。

## 6. 验收冒烟

1. **复现你这次的场景**：长任务触发上下文压缩 → 通道 C → 出现黄色卡片。  
   - 期望：开启自动续跑后 200s 内自动续跑（消息列表出现灰色 `🔁 自动续跑 · 中断`，无用户气泡）。
2. **关窗 30 分钟**：会话开启无人值守，关闭 Desktop 主窗口（保持 `agx serve` 运行）。  
   - 期望：30 分钟后重新打开，会话已推进至少 1 轮 supervisor 续跑或已 `done/failed`。
3. **死循环防护**：用一个故意循环的 prompt 跑无人值守，`max_continuations_per_session=3`。  
   - 期望：第 4 次前停止，`execution_state=failed`，消息摘要可读。
4. **todo 完成门禁**：跑一个 5 步 todo 任务，模型每一步真做完。  
   - 期望：最后一步 completed 后 Supervisor 不再 nudge，写入 `✅ 任务已完成`。

## 7. 风险与回滚

- **误触发计费**：默认全局关闭 + 单会话开关；首次启用弹一次解释性确认。
- **Supervisor 与 Desktop 重复 nudge**：`/continue` API 内置幂等（同 session 同 reason 60s 内去重）。
- **回滚路径**：FR-1/FR-2/FR-3 可独立回滚（仅 Desktop 改动 + 后端新增端点）；FR-4 走 feature flag `runtime.unattended.enabled`，关闭即等效现状。
- **观测**：`~/.agenticx/logs/supervisor/<session_id>.log` 每次 continuation 写一行 JSONL（reason / round / model / tokens）。

## 8. 实施顺序建议

1. **FR-1 + FR-2**（最小可交付，2-3 天）：先解决「假用户气泡」与「续跑路径多头」。
2. **FR-3**（同 PR 或紧随）：扩展 auto-nudge 触发条件，闭环你这次反馈的核心场景。
3. **FR-4 + FR-5 + FR-6**（独立 PR）：上 Supervisor + 硬上限 + todo 门禁。
4. **FR-7**：UI 收尾。

每个阶段独立可发版，FR-1/2/3 不依赖 FR-4。

---

## 9. 实现引用（便于 commit 时锚定）

- 触发器现状：`desktop/src/components/ChatPane.tsx:4028-4066`（auto-nudge useEffect）、`4080-4108`（resumeCurrentTask）
- 后端 execution_state：`agenticx/studio/server.py:_resolve_chat_end_execution_state`、`session_manager.py:set_execution_state`
- 三通道 stall：`desktop/src/utils/task-stall-policy.ts`
- 现有配置入口：`desktop/src/components/automation/StallNudgeConfigSection.tsx`、`desktop/electron/main.ts` runtime config IPC
- 长任务编排参考：`agenticx/longrun/orchestrator.py`（仅参考其 stall/retry 设计，不直接接入聊天 session）
