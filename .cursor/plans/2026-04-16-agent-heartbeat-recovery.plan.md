---
name: agent-heartbeat-recovery
overview: "Agent 任务断点续跑（心跳恢复）+ max_tool_rounds 等运行时参数面板化"
todos:
  - id: p0-detect-stall
    content: "P0: 前端检测 SSE 断连/静默超时，显示'任务可能已中断'恢复入口"
    status: pending
  - id: p0-resume-button
    content: "P0: 恢复按钮：一键发送'继续执行'到同 session，自动续跑"
    status: pending
  - id: p0-bg-complete-notify
    content: "P0: 后台任务完成后前端通知（轮询 execution_state 变化 + toast 提示）"
    status: pending
  - id: p1-max-rounds-panel
    content: "P1: 设置面板新增 Runtime 区域，可视化调节 max_tool_rounds"
    status: pending
  - id: p1-max-rounds-persist
    content: "P1: 面板修改写入 ~/.agenticx/config.yaml 并即时生效"
    status: pending
  - id: p2-auto-resume
    content: "P2: max_tool_rounds 耗尽时自动发送继续指令（可配置开关）"
    status: pending
isProject: false
---

# Agent 断点续跑（心跳恢复）+ 运行时参数面板化

## 问题背景

Issue #8 解决了工具执行期间的消息排队和流式进度，但暴露了更深层的 UX 缺陷：

1. **Agent 静默停止**：SSE 连接断开（切 session / 网络波动 / 超时）后，后端继续跑完任务但前端不知道，表现为"突然没了心跳"
2. **max_tool_rounds 耗尽无感知**：达到工具调用上限后，后端发 error 事件但前端只显示一个红叉，无恢复入口
3. **运行时参数不可视**：`max_tool_rounds`（默认 30）只能改 YAML 文件，用户无法在设置面板调整

## 根因

| 症状 | 根因 | 影响 |
|------|------|------|
| "Agent 突然不动了" | SSE 连接断开后前端不重连，后端跑完但结果无人接收 | 用户以为 Agent 挂了 |
| "跑到一半就停了，没有任何提示" | `max_tool_rounds` 耗尽，error 事件被 abort 吞掉或未渲染恢复 UI | 长任务永远跑不完 |
| "怎么调大工具调用次数？" | 只能改 `~/.agenticx/config.yaml` 的 `runtime.max_tool_rounds` | 普通用户无法操作 |

---

## P0: 前端断连检测 + 恢复入口 + 后台完成通知

### 1. SSE 断连/静默超时检测

在 `ChatPane.tsx` 的 SSE 读取循环中，增加心跳超时检测：

- 后端每 2s 发 `tool_progress` 心跳，前端记录 `lastEventAt`
- 若超过 **15s** 无任何 SSE 事件且 `sessionStreamStateRef.active` 仍为 true：
  - 视为"可能断连"
  - 在消息列表末尾渲染 `StallRecoveryCard`
  - 内容：`⚠️ 该任务可能已中断（15 秒无响应）`
  - 两个按钮：「恢复执行」 / 「中断任务」

### 2. 恢复按钮（"电击复活"）

`StallRecoveryCard` 的「恢复执行」按钮逻辑：

```ts
const resumeTask = () => {
  // 先查后端 execution_state
  // 如果 idle → 说明已跑完，发 "请汇报之前任务的执行结果" 触发结果回显
  // 如果 running → 说明后端还在跑，重建 SSE 监听（重发 /api/chat 带 resume 语义）
  // 如果 interrupted → 发 "继续执行之前的任务" 让 Agent 接续
};
```

### 3. 后台任务完成通知

在 `ChatPane.tsx` 中增加 `execution_state` 轮询：

- 当 `sessionStreamStateRef.active` 为 false 但上次已知状态为 running 时
- 每 3s 查询 `GET /api/sessions`（已有 1.5s 轮询可复用）
- 检测到 `running → idle` 变化时：
  - 在消息区显示 `✅ 后台任务已完成` toast
  - 自动刷新 `loadSessionMessages` 回填结果

### 4. max_tool_rounds 耗尽专属 UI

在前端 `error` 事件处理中识别 `"已达到最大工具调用轮数"` 文案：

- 不再只显示红叉
- 渲染 `ToolRoundsExhaustedCard`：
  - 显示已执行轮数 / 当前上限
  - 「继续执行」按钮（自动发 "继续执行，从上次停止的地方接续"）
  - 「调整上限」链接（跳转设置面板 Runtime 区）

---

## P1: max_tool_rounds 设置面板化

### 1. 设置面板 Automation Tab 新增 Runtime 区

在 `SettingsPanel.tsx` 的 Automation Tab（或新建 Runtime 区块）中：

```
┌─ 运行时参数 ──────────────────────────┐
│                                        │
│  最大工具调用轮数                       │
│  [====●=====] 80                       │
│  范围: 10 ~ 120                        │
│  当前任务需要多轮工具调用时，           │
│  建议适当提高此值。                     │
│                                        │
└────────────────────────────────────────┘
```

- Slider + 数字输入框
- 范围 10-120（与后端 guardrail 对齐）
- 实时预览 + 保存按钮

### 2. IPC + 后端持久化

- 新增 IPC：`get-runtime-config` / `save-runtime-config`
- 读写 `~/.agenticx/config.yaml` 的 `runtime.max_tool_rounds`
- 保存后无需重启后端（`_resolve_max_tool_rounds()` 每次调用时从文件读取）

### 3. 全局 d.ts 类型补全

```ts
loadRuntimeConfig: () => Promise<{ ok: boolean; max_tool_rounds: number }>;
saveRuntimeConfig: (payload: { max_tool_rounds: number }) => Promise<{ ok: boolean }>;
```

---

## P2: max_tool_rounds 耗尽自动续跑（可配置）

### 方案

- 在 `~/.agenticx/config.yaml` 新增：

```yaml
runtime:
  max_tool_rounds: 80
  auto_resume_on_exhaustion: true   # 耗尽后自动继续
  max_auto_resumes: 3               # 最多自动续跑 3 次（防止无限循环）
```

- 后端 `run_turn` 循环结束时，若 `auto_resume_on_exhaustion` 为 true 且未达 `max_auto_resumes`：
  - 自动注入 `"继续执行，从上次停止的地方接续"` 作为新 user message
  - 开始新一轮 `run_turn`
  - 前端自动感知（同一 SSE 流继续）

- 设置面板增加开关：「工具调用上限耗尽时自动继续」

---

## 改动范围汇总

| 阶段 | 涉及文件 | 改动量预估 |
|------|---------|-----------|
| P0 | `ChatPane.tsx`, `ChatView.tsx`, 新增 `StallRecoveryCard.tsx`, 新增 `ToolRoundsExhaustedCard.tsx` | ~250 行 |
| P1 | `SettingsPanel.tsx`, `main.ts`, `preload.ts`, `global.d.ts` | ~150 行 |
| P2 | `agent_runtime.py`, `server.py`, `config_manager.py`, `SettingsPanel.tsx` | ~200 行 |

## 风险与注意事项

- **P0 心跳检测阈值**：15s 需要根据实际模型响应延迟调整（deepseek-r1 思考时间可能更长）
- **P0 恢复执行 vs 新对话**：恢复时必须复用原 session 上下文，不能开新 session
- **P1 slider 范围**：与后端 `max(10, min(120, value))` guardrail 对齐
- **P2 自动续跑防环**：必须有硬上限，避免 Agent 在死循环任务上无限烧 token
- **不改动 Issue #8 已有逻辑**：严格遵循 no-scope-creep 规则
