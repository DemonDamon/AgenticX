# Message Timestamps + Sort by Last Reply Time

Plan-Id: 2026-05-29-message-timestamps-and-reply-time-sort

## Problem

1. History list ordering looks wrong: old conversations jump to the top of the
   TODAY bucket. Root cause: every persisted message in `messages.json` has
   `timestamp: None`. The backend never stamps message timestamps when writing
   the `chat_history` snapshot. As a result `_resolve_list_activity_at` cannot
   use the real "last model reply" time and falls back to metadata
   `updated_at`, which is polluted by rename / taskspace / other non-activity
   operations.
2. Messages do not display a timestamp at all. The user wants a Codex-style
   timestamp (year-month-day hour:minute, no seconds) revealed on hover for both
   the user query and the model reply.

## Goals

- Persist a real `timestamp` (ms epoch) on every chat_history message.
- Session list ordering reflects the last completed model reply time
  (auto-satisfied once messages carry timestamps; `_resolve_list_activity_at`
  already takes the max message timestamp).
- Show per-message timestamp on hover in `ImBubble`, formatted `YYYY-MM-DD HH:mm`.

## Non-Goals

- Changing the sorting algorithm itself.

### FR-3 Backfill script for existing sessions
- Module: `agenticx/memory/message_timestamp_backfill.py`
- CLI: `scripts/backfill_message_timestamps.py`
- Spread monotone timestamps between session `created_at` / `updated_at` from SQLite
  summaries; anchor **last assistant** message to `end_ms` for last-reply sorting.
- `--apply` writes `messages.json`; `--reindex-fts` rebuilds FTS index.

## Changes

### FR-1 Backend: stamp message timestamps on persist
- File: `agenticx/studio/session_manager.py`
- In `_save_messages_snapshot`, before writing, mutate each message dict in place
  to set `timestamp = int(time.time() * 1000)` when it is missing/falsy.
- Because call sites pass `session.chat_history` by reference, the stamp persists
  into the in-memory history too, so later saves keep the same value.

### FR-2 Frontend: render timestamp on hover
- File: `desktop/src/components/messages/ImBubble.tsx`
- Add a small, muted timestamp element near the action button row.
- Hidden by default; visible on `group-hover` (row already has `group`).
- Format helper: `YYYY-MM-DD HH:mm` from `message.timestamp` (ms epoch).
- Applies to both user and assistant bubbles; skip streaming / typing placeholders
  and messages without a timestamp.

## Acceptance Criteria

- AC-1: After a new turn, `messages.json` entries have numeric `timestamp`.
- AC-2: A session whose last reply is newer sorts above an older-replied session
  in the history panel TODAY bucket.
- AC-3: Hovering a user or assistant bubble reveals `YYYY-MM-DD HH:mm`.
- AC-4: Streaming placeholder and typing rows show no timestamp; pre-existing
  messages without a timestamp render without a hover time (no crash).
