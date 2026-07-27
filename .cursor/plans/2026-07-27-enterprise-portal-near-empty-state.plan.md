# Enterprise Portal 空态 NEAR 字标与输入区比例

Planned-with: grok-4.5  
Suggested-Impl-Model: grok-4.5

## Goal

前台 web-portal 聊天空态去掉大头像 / 欢迎文案 / 建议卡，改为 NEAR 字标 + 居中输入区；调整空态输入框宽高与占位文案，深度研究空态 pill 暂隐藏（侧栏入口保留）。

## In scope

- `enterprise/apps/web-portal/src/components/NearEmptyWordmark.tsx`（新建）
- `enterprise/apps/web-portal/src/components/MachiChatView.tsx` 空态分支与 composer 空态尺寸
- `enterprise/features/chat/src/components/molecules/InputArea.tsx`：`minTextareaHeight` / hero 高度行为；默认 placeholder → Near

## Out of scope

- Desktop / admin-console
- 深度研究 BFF / 租户开关逻辑
- 其他能力 pill（文档 / PPT 等）

## Requirements

- FR-1: 空态展示整词基线对齐的 NEAR 字标；悬浮为字距收紧 + 底线展开（不做字母替换图标）
- FR-2: 空态输入区独立 `max-w-[46rem]` / `min-h-[9.75rem]`；有消息后仍 `max-w-4xl`
- FR-3: placeholder 为「发送消息给 Near...」（深度研究模式沿用专用文案）
- FR-4: 空态下方深度研究 pill 隐藏；侧栏进入深度研究不变

## Acceptance

- AC-1: 新会话空态可见 NEAR，无大头像与建议卡
- AC-2: 空态输入框宽高与有消息态不同；文案为 Near
- AC-3: 侧栏「深度研究」仍可进入模式；空态下方无 pill
