# Plan: view_image 注入消息改为工具风格卡片（非用户气泡）

**Date**: 2026-06-12  
**Scope**: `agenticx/runtime/agent_runtime.py`, `agenticx/cli/agent_tools.py`, Desktop 消息渲染

## Problem

模型调用 `view_image` 后，runtime 会向 LLM 注入一条 `role: user` 的多模态消息。旧实现把 `<system-injected> attached images requested via view_image tool:` 写入 `chat_history.content`，Desktop 渲染成**右侧用户气泡**，像用户在说话，体验错误。

## Requirements

- **FR-1**: LLM 侧仍保留 `role: user` + multimodal content（API 要求不变）。
- **FR-2**: `chat_history` 持久化行：`content` 为空，`metadata.source = view_image_inject`，`visual_attachments` 含缩略图 `data_url`。
- **FR-3**: Desktop 识别 inject 行（metadata 或 legacy 英文前缀），渲染左侧工具风格 `ViewImageInjectCard`，不走 `ImBubble`。
- **AC-1**: 新 inject 行不显示为用户气泡；有附件时展示缩略图。
- **AC-2**: 旧 session 仅含 legacy 前缀的行仍可识别为 inject 卡片。

## Changes

- Backend: `VIEW_IMAGE_INJECT_*` 常量；`_inject_pending_visual_attachments` 双写结构；`session_manager` 持久化 `visual_attachments`。
- Desktop: `view-image-inject.ts`, `ViewImageInjectCard.tsx`, `MessageRenderer` 路由，`session-message-map` 映射。
- **Spacing (follow-up)**: inject 行并入 ReAct 块（`react-blocks.ts`）；有 inject 时启用统一 ReAct 卡片；工作列始终 `reactFlat`；`ViewImageInjectCard` 与工具链摘要行同款 `py-1`；ReAct 列 Thought→正文 `mt-1`。

Plan-Id: 2026-06-12-view-image-inject-display-ux  
Plan-File: .cursor/plans/2026-06-12-view-image-inject-display-ux.plan.md

Made-with: Damon Li
