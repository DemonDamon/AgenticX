# Enterprise 侧栏会话生成状态指示

## What & Why

右侧聊天流式生成时，左侧历史列表无状态反馈。对齐 Kimiwork：会话项前展示 2×3 圆点动画，切换会话后仍指向正在生成的 session。

## Requirements

- FR-1: sending/streaming 期间侧栏对应会话显示 Kimi 式六点状态
- FR-2: `streamingSessionId` 与右侧生成 session 绑定，切走仍保留指示
- FR-3: 生成结束 / 取消 / 失败后清除指示
- AC-1: 当前会话回答时侧栏标题左侧可见脉冲六点
- AC-2: 折叠侧栏 icon 区同步替换为六点

## Implementation

- `enterprise/features/chat/src/store.ts` — `streamingSessionId`
- `enterprise/apps/web-portal/src/components/SessionGeneratingDots.tsx`
- `enterprise/apps/web-portal/src/components/WorkspaceShell.tsx` — SessionItem / 折叠态
