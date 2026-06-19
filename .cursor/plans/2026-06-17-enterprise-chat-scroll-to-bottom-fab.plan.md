# Enterprise 聊天回到底部浮动按钮

## What & Why

用户上滑查看历史时，流式输出在下方继续，缺少快速回到底部入口。对齐 Kimi work / Near：输入框上方右侧展示圆形向下箭头，点击平滑滚至最新消息。

## Requirements

- FR-1: 列表可滚动且未在底部时显示 FAB
- FR-2: 点击 FAB 平滑滚动到底并 re-pin 自动跟随
- FR-3: 用户上滑后流式输出不强制滚底；在底部时继续跟随新内容
- AC-1: 上滑后出现按钮，点击回到底部
- AC-2: scroll-near-bottom 单测通过

## Implementation

- `enterprise/features/chat/src/utils/scroll-near-bottom.ts`
- `enterprise/features/chat/src/components/molecules/MessageList.tsx`
- `enterprise/apps/web-portal/src/components/MachiChatView.tsx` — i18n label
