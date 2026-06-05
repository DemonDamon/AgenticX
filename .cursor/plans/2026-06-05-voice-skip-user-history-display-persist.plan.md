---
name: voice-skip-user-history-display-persist
overview: 修复 skip_user_history 与语音轮次落盘时用户 query 缺失导致 messages.json 出现「无 user 气泡的 assistant」；会话 3f9757b1 历史数据无法自动补回，仅防再发。
date: 2026-06-05
status: completed
owner: Damon Li
tags: [desktop, studio, voice-focus, persistence, chat-history]
todos:
  - id: backend-display-persist
    content: agent_runtime skip_user_history 时仍向 chat_history 写入 display-only user（排除 continuation/auto-nudge）
    status: completed
  - id: continuation-helper
    content: continuation.is_continuation_user_prompt 识别内部续跑 prompt
    status: completed
  - id: voice-user-final-enqueue
    content: VoiceFocusMode user_final 立即 enqueue；assistant_final 用 partial 兜底；bridge 校验后再入队
    status: completed
  - id: smoke-tests
    content: 补充 is_continuation_user_prompt 与 skip_user_history display persist 冒烟测试
    status: completed
isProject: false
---

# 用户 query 丢失（无 user 气泡 assistant）修复

**Plan-Id**: 2026-06-05-voice-skip-user-history-display-persist
**Plan-File**: `.cursor/plans/2026-06-05-voice-skip-user-history-display-persist.plan.md`

## 现象
- 会话 `3f9757b1-1755-4b8a-9387-4abe81e42f41`：assistant「可以。我在。」前无对应 user 气泡
- `messages.json` index 87 为 assistant，thinking 写明用户问候「能不能听到」，但磁盘无 user 行
- `agent_messages.json` 同样缺 user（`persist_user_message=False` / skip_user_history 路径）

## 根因
1. Desktop `skip_user_history=true`（续跑/隐式 retry 等）时模型仍收到 `user_input`，但 `chat_history` 不写入 user
2. 语音灵巧模式原先等 `assistant_final` 才 flush draft，ASR 无 `user_final` 时 user 不落盘
3. 前端 `visibleMessages` 过滤非主因——磁盘本身缺 user

## 改动
- `agenticx/studio/continuation.py`：`is_continuation_user_prompt()`
- `agenticx/runtime/agent_runtime.py`：`persist_user_message=False` 时 display-only user + mid_turn_persist（tail 已有相同 user 则跳过，避免 retry 重复）
- `desktop/src/components/VoiceFocusMode.tsx`：`user_final` 立即入队；`user_partial` 缓存；`assistant_final` partial 兜底；bridge 校验后入队 user

## 验收
- AC-1：`skip_user_history` 的真实用户句仍出现在 `messages.json` chat_history
- AC-2：continuation/auto-nudge 内部 prompt 不写入 user 气泡
- AC-3：语音 `user_final` 后挂断刷新可见 user（先于 assistant）
- AC-4：历史会话 `3f9757b1-...` 已缺行不自动修复（文档说明即可）

Made-with: Damon Li
