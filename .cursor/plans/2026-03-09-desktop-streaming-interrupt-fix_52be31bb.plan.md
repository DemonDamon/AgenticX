---
name: 2026-03-09-desktop-streaming-interrupt-fix
overview: 修复 AgenticX Desktop 当前两项可用性问题：回复改为真正流式增量渲染，以及新增可用的“中断当前生成”能力（含前端与服务端最小联动）。
todos: []
isProject: true
phases:
  - name: "Phase 1: 流式增量渲染（P0）"
    todos:
      - id: p1-stream-message-lifecycle
        content: 在 ChatView 建立 assistant 占位消息生命周期：发送即创建占位，token 到达即增量更新，final 事件兜底覆盖，避免重复落盘。
        status: pending
      - id: p1-ui-streaming-polish
        content: 保留正在生成态视觉反馈，但以真实增量文本为主；处理 token/final 去重与滚动到底部稳定性。
        status: pending
  - name: "Phase 2: 中断按钮（P1 前端）"
    todos:
      - id: p2-abort-controller
        content: 为每轮 /api/chat 绑定 AbortController；新增“中断”按钮，仅 streaming 状态可见/可用。
        status: pending
      - id: p2-interrupt-state-reset
        content: 点击中断后立即停止读取流、恢复 idle、保留已生成内容并给出明确中断提示。
        status: pending
  - name: "Phase 3: 服务端收敛与防悬挂（P1 后端）"
    todos:
      - id: p3-server-disconnect-aware
        content: 在 server SSE 事件流中对客户端断连/生成异常做安全收敛，避免后台继续无意义推流。
        status: pending
      - id: p3-runtime-checkpoints
        content: 在 runtime 合适检查点增加可中断退出路径（不改变既有确认/工具调用语义）。
        status: pending
  - name: "Phase 4: 验证与回归"
    todos:
      - id: p4-manual-verification
        content: 手工验证：长回答流式可见、可中断、确认弹窗流程不回归、错误事件可见。
        status: pending
      - id: p4-test-and-lint
        content: 补/改最小测试并执行相关测试命令，记录证据与风险。
        status: pending
---

# AgenticX Desktop 流式与中断修复计划

## 目标

修复 Desktop 聊天体验中的两个阻塞问题：

- 回复需按 token 增量渲染（非结束后一次性展示）
- 提供“中断当前生成”按钮，用户可立即停止当前轮次并恢复可交互状态

## 关键现状与证据

- `desktop/src/components/ChatView.tsx` 当前仅在本地变量累积 token，流结束后才 `addMessage("assistant", full)`，导致非实时展示。
- 当前无 AbortController、无中断按钮；发送期间只能等待结束。
- `agenticx/studio/server.py` 与 `agenticx/runtime/agent_runtime.py` 无取消协议；最小可用方案先做前端中断+服务端断连感知，避免无意义继续推流。

## 实施策略

- 先做前端可感知的真流式渲染与中断按钮（P0/P1）。
- 同步补充服务端对客户端断连/取消的快速收敛（P1）。
- 以“最小改动、避免引入新协议复杂度”为先；必要时把完整 `/api/cancel` 协议化能力列入下一迭代。

## 变更范围（初步）

- `desktop/src/components/ChatView.tsx`
- `desktop/src/store.ts`（如需支持按 id 增量更新消息）
- `agenticx/studio/server.py`（断连/异常收敛）
- `agenticx/runtime/agent_runtime.py`（必要时增加可中断检查点）
- `tests/*`（补充流式与中断用例，按现有测试结构最小增量）

