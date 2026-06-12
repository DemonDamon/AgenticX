# Plan: Persist user-uploaded chat images (data URLs) in session history so they become visible after switching to a vision-capable model

**Date**: 2026-06-12
**Scope**: `agenticx/studio/server.py` (history attachment recording) + `agenticx/runtime/agent_runtime.py` (enrichment + promotion on replay)
**Related bug**: User uploads image while a text-only model is selected → image chip appears in UI for that turn, but after switching the pane/session model to a vision model (or on later turns / reload), the LLM cannot see the prior image. The runtime fell back to suggesting `view_image` on a non-persisted client temp path (e.g. `/Users/.../image.png`), and no stable `data:image/...` payload existed in `messages.json` for the historical user turn.

## Root Cause (FR-level)
- `server.py:/api/chat` normalized client `image_inputs`, then *unconditionally* cleared `image_inputs = []` (and therefore skipped `history_user_attachments = _history_attachments_from_image_inputs(...)`) when the *current* session model was not vision-capable.
- The user turn written to `session.chat_history` (and by extension what Desktop reloads via `GET /api/session/messages` → `attachmentsFromSessionRow`) only received attachments when the send-time model accepted vision.
- `agent_messages` (the source of truth for runtime history replay / compaction) was written with plain text `content`, losing the bytes.
- On a later vision-model turn, nothing re-hydrated the prior turn's image bytes into `content: [{type:"text"}, {type:"image_url", ...}]` blocks for the LLM call. `strip_nonvision_multimodal_messages` only strips; there was no symmetric "promote when now vision" step for *historical* attachments.
- `view_image` tool is intentionally for *agent-driven* visual inspection of tool-produced paths/URLs, not a substitute for user chat attachments.

## Requirements
- **FR-1 (core)**: User-uploaded images (carrying `data:image/*` data URLs) must be recorded in the persisted user message row (`chat_history` + `agent_messages` attachments) *regardless* of the model selected at send time. The bytes must be self-contained in `messages.json`.
- **FR-2**: When a later turn (or resumed session) targets a vision-capable model, the runtime must automatically promote historical user turns that carry image-bearing attachments into native multimodal content for that LLM call.
- **FR-3**: Non-vision models at any given turn must continue to receive stripped (text-only) history — no behavior change for them, and no extra tokens.
- **FR-4**: Existing `view_image` / web_fetch visual flows, retry, and Desktop attachment chips continue to work.
- **NFR-1**: Persist images under `~/.agenticx/sessions/<sid>/uploads/` with `storage_path` on attachments (inline `data_url` retained for UI); backfill on session restore/persist.
- **NFR-2**: Keep the change minimal and defensive (try/except around the new enrichment/promotion, matching existing patterns).

## Acceptance Criteria (AC)
- **AC-1**: Upload image with a text-only model selected → the turn's row in `messages.json` (via chat_history) contains an `attachments` array with `{name, mime_type, size, data_url: "data:image/..."}`. Desktop can re-render the image chip after full reload.
- **AC-2**: After the above, switch the active model for the pane/session to a vision-capable model (e.g. a qwen-vl / gpt-4o / etc. SKU) and send any follow-up (or just let the next agent turn run) → the LLM receives the prior user turn's image as real `image_url` content blocks (inspectable in the request or via logs) and can describe it.
- **AC-3**: If the model at a given turn is still non-vision, the same historical attachment row is present in `chat_history` but the working messages passed to the LLM have the image parts flattened (existing `strip_nonvision_multimodal_messages` behavior) with the explanatory suffix.
- **AC-4**: All existing vision tests continue to pass:
  - `tests/test_llm_vision.py`
  - `tests/test_agent_runtime_visual_injection.py`
  - `tests/test_view_image_tool.py`
- **AC-5**: No regression for pure-text sessions, context_files attachments, or retry flows.

## Design Notes
- In `server.py` (the `/api/chat` SSE handler): capture `history_image_attachments = _history_attachments_from_image_inputs(image_inputs)` *immediately* after normalization, *before* the `if not is_vision_capable: image_inputs = []` guard. Always feed the history version into the `history_user_attachments` that gets passed to `runtime.run_turn(...)` (and thus written to both `agent_messages` and `chat_history` for the user turn). Only the *immediate* `user_message_content` (the content actually appended to the in-flight messages for this LLM call) remains gated on the current model's capability.
- In `agent_runtime.py`:
  - `_enrich_attachments_from_chat_history(...)` (already present) aligns `chat_history` image attachments back onto `agent_messages`-derived history entries on replay/resume (heals pre-fix data and chat_history-only rows).
  - `_promote_user_image_attachments(messages, provider, model)` (already present, called right after `messages.extend(compacted_history)`) walks the working message list; when `is_vision_capable(provider, model)` it converts any user entry that now has image `attachments` into a proper multimodal `content` list. It handles already-rich content and de-dupes.
- The new user turn append for the *current* send (`am_user = {"role": "user", "content": user_content, "attachments": ...}` when `history_user_attachments`) already stores rich content when the client supplied images, giving the same session the ability to re-promote on future vision turns without relying on `chat_history` healing.
- `strip_nonvision_multimodal_messages` remains the backstop for any residual image blocks when a non-vision model is chosen for a turn.
- Data URLs are already capped (max ~8 MB per the `_normalize_image_inputs` constant), so we are not introducing new unbounded storage.

## Changes Made
1. `agenticx/studio/chat_attachments.py` (new)
   - Materialize `data:image/*` to `sessions/<sid>/uploads/`, sync attachments chat_history ↔ agent_messages, resolve by basename for `view_image`.
2. `agenticx/studio/server.py`
   - Capture `history_image_attachments` before non-vision strip; materialize uploads; always persist to user turn history.
3. `agenticx/studio/session_manager.py`
   - Backfill uploads on restore; materialize before persist; preserve `storage_path` in `_normalize_messages`.
4. `agenticx/runtime/agent_runtime.py`
   - Enrich + promote historical image attachments for vision models; persist attachments on user turns.
5. `agenticx/cli/agent_tools.py`
   - `view_image` resolves session chat uploads by filename before workspace path lookup.
6. `desktop/src/components/ChatPane.tsx`
   - Always send `image_inputs`; do not mirror chat images into `context_files`.
7. `tests/test_chat_attachments.py`

## Test / Verification
- Ran the dedicated vision tests after the changes:
  - `tests/test_llm_vision.py` — 4 passed
  - `tests/test_agent_runtime_visual_injection.py` — 2 passed
  - `tests/test_view_image_tool.py` — 6 passed
- Manual scenario (per user report): image uploaded under text model → persisted with `data_url` in the user row → switch model to vision → follow-up turn causes the historical image to be promoted and visible to the LLM (no more "file not found" via view_image or "I can't see the image" responses).

## Risks / Rollback
- Low risk: the new path only adds data to history rows and only activates promotion for vision models (guarded by the existing `is_vision_capable` predicate). Non-vision turns continue to be stripped.
- If a customer has extremely long chat histories with many large images, token usage on vision-model turns will naturally increase when the images are promoted (this is the desired/expected behavior; previously those images were invisible). The existing context budget / compactor mechanisms still apply.
- Rollback: revert the early capture + history attachment contribution in `server.py`; the runtime promotion code can stay (it is a no-op when there are no attachments or when the model is non-vision).

## Plan-Id / Traceability
Plan-Id: 2026-06-12-user-chat-image-persistence-for-vision-model-switch
Plan-File: .cursor/plans/2026-06-12-user-chat-image-persistence-for-vision-model-switch.plan.md

Made-with: Damon Li
