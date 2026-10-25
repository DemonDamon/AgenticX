#!/usr/bin/env python3
"""Consolidate a memory store and past sessions into a new memory store.

The model returns a complete working set for each batch. Nothing here writes
the input store or opens a managed session.

Author: Damon Li
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from agenticx.managed.memory import validate_memory_path
from agenticx.skills.guard import scan_skill_markdown_text, should_allow

MAX_DREAM_SESSIONS = 100
MAX_INSTRUCTIONS_CHARS = 8000
MAX_DREAM_MEMORIES = 300
MAX_DREAM_TOTAL_BYTES = 204800
MAX_MEMORY_CONTENT_BYTES = 102400
MAX_MESSAGE_CHARS = 4000
MAX_SESSION_CHARS = 20000
BATCH_CHARS = 60000
DEFAULT_INSTRUCTIONS_HINT = (
    "保留稳定的偏好、约定与已验证的结论；删除重复、过期和互相矛盾的内容；"
    "删除姓名、邮箱、手机号、订单号等个人身份信息；按主题组织为若干文件。"
)
_MESSAGE_TYPES = frozenset({"user.message", "agent.message"})
_SYSTEM_PROMPT = """You consolidate long-term memory for an AI agent team.
You receive the current memory files, a batch of past conversations, and instructions.
Return the COMPLETE new set of memory files as JSON and nothing else:
{"memories": [{"path": "/topic/name.md", "content": "markdown text"}], "notes": "one paragraph on what changed"}
Rules:
- Follow the instructions exactly. Keep only stable, reusable knowledge.
- Merge duplicates, drop outdated or conflicting items (prefer newer conversations), group by topic.
- Paths start with "/", use lowercase words separated by "-" or "/", end with ".md".
- Never include passwords, tokens, API keys, or other secrets.
- At most 300 files; each file under 100 KB."""
_RETRY_USER = "Your previous reply was not valid JSON. Return ONLY the JSON object."


@dataclass(frozen=True)
class DreamMemory:
    path: str
    content: str


@dataclass(frozen=True)
class SessionTranscript:
    session_id: str
    title: str | None
    text: str


@dataclass
class DreamOutcome:
    memories: list[DreamMemory]
    rejected: list[dict[str, str]]
    notes: str
    batches: int


class DreamError(Exception):
    def __init__(self, error_type: str, message: str) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.message = message


def _text_blocks(content: Any) -> str:
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if not isinstance(block, Mapping):
            continue
        if block.get("type") != "text" or not isinstance(block.get("text"), str):
            continue
        parts.append(block["text"])
    return "".join(parts)


def _role_line(event_type: str, text: str) -> str:
    role = "user" if event_type == "user.message" else "assistant"
    return f"{role}: {text[:MAX_MESSAGE_CHARS]}"


def transcript_from_events(
    session_id: str,
    title: str | None,
    events: Sequence[Mapping[str, Any]],
) -> SessionTranscript | None:
    """Keep primary-thread user and assistant text, dropping the oldest lines past the cap."""
    lines: list[str] = []
    for event in events:
        event_type = event.get("type")
        if event_type not in _MESSAGE_TYPES:
            continue
        thread_id = event.get("thread_id")
        if thread_id is None:
            thread_id = ""
        if not isinstance(thread_id, str) or thread_id != "":
            continue
        text = _text_blocks(event.get("content"))
        if text == "":
            continue
        lines.append(_role_line(str(event_type), text))
    while lines and len("\n".join(lines)) > MAX_SESSION_CHARS:
        lines.pop(0)
    if not lines:
        return None
    return SessionTranscript(session_id=session_id, title=title, text="\n".join(lines))


def batch_transcripts(transcripts: Sequence[SessionTranscript]) -> list[list[SessionTranscript]]:
    """Pack transcripts in order. A batch's combined text length stays within BATCH_CHARS."""
    batches: list[list[SessionTranscript]] = []
    current: list[SessionTranscript] = []
    used = 0
    for item in transcripts:
        size = len(item.text)
        if current and used + size > BATCH_CHARS:
            batches.append(current)
            current = []
            used = 0
        current.append(item)
        used += size
    if current:
        batches.append(current)
    return batches


def check_input_memories(memories: Sequence[DreamMemory]) -> None:
    """Raise when the input store is larger than the dream working set can hold."""
    total = 0
    for memory in memories:
        total += len(memory.content.encode("utf-8"))
    if len(memories) > MAX_DREAM_MEMORIES or total > MAX_DREAM_TOTAL_BYTES:
        raise DreamError(
            "input_too_large",
            "input memory store exceeds the dream limit (300 memories / 200 KiB)",
        )


def _memory_block(memories: Sequence[DreamMemory]) -> str:
    if not memories:
        return "(empty)"
    chunks: list[str] = []
    for memory in memories:
        chunks.append(f"--- {memory.path} ---\n{memory.content}")
    return "\n".join(chunks)


def _session_heading(transcript: SessionTranscript) -> str:
    if transcript.title:
        return f"=== session {transcript.session_id} · {transcript.title} ==="
    return f"=== session {transcript.session_id} ==="


def build_dream_messages(
    *,
    instructions: str,
    memories: Sequence[DreamMemory],
    batch: Sequence[SessionTranscript],
    batch_index: int,
    batch_count: int,
) -> list[dict[str, str]]:
    """One system prompt plus the current working set and this conversation batch."""
    conversations = "\n".join(
        f"{_session_heading(item)}\n{item.text}" for item in batch
    )
    user = (
        f"## Instructions\n{instructions}\n\n"
        f"## Current memory files ({len(memories)} files)\n"
        f"{_memory_block(memories)}\n\n"
        f"## Conversations (batch {batch_index + 1} of {batch_count})\n"
        f"{conversations}\n"
    )
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def _loads_object(text: str) -> Mapping[str, Any] | None:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            parsed = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def parse_dream_response(text: str) -> tuple[list[DreamMemory], str] | None:
    """Parse a model reply. Non-object elements and missing string fields are skipped."""
    parsed = _loads_object(text)
    if parsed is None:
        return None
    raw_memories = parsed.get("memories")
    if not isinstance(raw_memories, list):
        return None
    memories: list[DreamMemory] = []
    for item in raw_memories:
        if not isinstance(item, Mapping):
            continue
        path = item.get("path")
        content = item.get("content")
        if not isinstance(path, str) or not isinstance(content, str):
            continue
        memories.append(DreamMemory(path=path, content=content))
    notes = parsed.get("notes")
    if not isinstance(notes, str):
        notes = ""
    return memories, notes


def _passes_safety_scan(content: str) -> bool:
    result = scan_skill_markdown_text(content, source="agent-created")
    allowed, _reason = should_allow(result, source="agent-created")
    return allowed


def gate_memories(
    memories: Sequence[DreamMemory],
) -> tuple[list[DreamMemory], list[dict[str, str]]]:
    """Drop unsafe, empty, oversized, duplicate, and over-limit files. The last duplicate wins."""
    staged: list[tuple[str, str, str | None]] = []
    for memory in memories:
        try:
            path = validate_memory_path(memory.path)
        except Exception:
            staged.append((memory.path, memory.content, "invalid path"))
            continue
        content = memory.content
        if content.strip() == "":
            staged.append((path, content, "empty content"))
            continue
        if len(content.encode("utf-8")) > MAX_MEMORY_CONTENT_BYTES:
            staged.append((path, content, "content too large"))
            continue
        if not _passes_safety_scan(content):
            staged.append((path, content, "blocked by safety scan"))
            continue
        staged.append((path, content, None))

    last_index: dict[str, int] = {}
    for index, (path, _content, reason) in enumerate(staged):
        if reason is None:
            last_index[path] = index

    kept: list[DreamMemory] = []
    rejected: list[dict[str, str]] = []
    total = 0
    for index, (path, content, reason) in enumerate(staged):
        if reason is not None:
            rejected.append({"path": path, "reason": reason})
            continue
        if last_index.get(path) != index:
            rejected.append({"path": path, "reason": "duplicate path"})
            continue
        size = len(content.encode("utf-8"))
        if len(kept) >= MAX_DREAM_MEMORIES or total + size > MAX_DREAM_TOTAL_BYTES:
            rejected.append({"path": path, "reason": "over limit"})
            continue
        kept.append(DreamMemory(path=path, content=content))
        total += size
    return kept, rejected


async def consolidate(
    *,
    memories: Sequence[DreamMemory],
    transcripts: Sequence[SessionTranscript],
    instructions: str,
    invoke: Callable[[list[dict[str, str]]], Awaitable[str]],
    should_stop: Callable[[], bool],
) -> DreamOutcome:
    """Merge batches into one working set, then keep only files that pass the gate."""
    check_input_memories(memories)
    if not transcripts:
        raise DreamError("no_sessions", "none of the sessions has usable text")
    batches = batch_transcripts(transcripts)
    working = list(memories)
    notes = ""
    for index, batch in enumerate(batches):
        if should_stop():
            raise DreamError("cancelled", "dream cancelled")
        messages = build_dream_messages(
            instructions=instructions,
            memories=working,
            batch=batch,
            batch_index=index,
            batch_count=len(batches),
        )
        parsed = parse_dream_response(await invoke(messages))
        if parsed is None:
            messages.append({"role": "user", "content": _RETRY_USER})
            parsed = parse_dream_response(await invoke(messages))
        if parsed is None:
            raise DreamError(
                "model_output_invalid",
                f"model returned invalid JSON at batch {index + 1}",
            )
        working, notes = parsed
    kept, rejected = gate_memories(working)
    return DreamOutcome(memories=kept, rejected=rejected, notes=notes, batches=len(batches))


__all__ = [
    "BATCH_CHARS",
    "DEFAULT_INSTRUCTIONS_HINT",
    "MAX_DREAM_MEMORIES",
    "MAX_DREAM_SESSIONS",
    "MAX_DREAM_TOTAL_BYTES",
    "MAX_INSTRUCTIONS_CHARS",
    "MAX_MEMORY_CONTENT_BYTES",
    "MAX_MESSAGE_CHARS",
    "MAX_SESSION_CHARS",
    "DreamError",
    "DreamMemory",
    "DreamOutcome",
    "SessionTranscript",
    "batch_transcripts",
    "build_dream_messages",
    "check_input_memories",
    "consolidate",
    "gate_memories",
    "parse_dream_response",
    "transcript_from_events",
]
