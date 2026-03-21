# Forward to avatar without open session

## Problem

`ForwardPicker` disables rows when no `sessionId` is found on an open pane, so users with only Meta-Agent cannot forward to other avatars.

## Requirements

- FR-1: Avatar and group rows are selectable even when no pane session exists; confirming creates or binds a session (same as sidebar open).
- FR-2: After forward, focus the target pane and refresh its messages from the server.
- FR-3: Optional follow-up text (e.g. 「你怎么看」) is sent as a separate user message after the forwarded history card.
- AC-1: Forward mirrors into `agent_messages`; Desktop triggers one `/api/chat` on the target pane (follow-up text or default prompt) so the avatar replies.

## Plan-Id

2026-03-21-forward-wake-avatar-session
