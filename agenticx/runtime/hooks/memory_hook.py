#!/usr/bin/env python3
"""Memory extraction hook for agent runtime.

Extracts key facts from conversations on agent_end and persists them.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
from datetime import date
from pathlib import Path
from typing import Any

from agenticx.runtime.hooks import AgentHook

logger = logging.getLogger(__name__)

MIN_CHAT_TURNS = 3
MAX_FACTS_PER_SESSION = 8


class MemoryHook(AgentHook):
    """Extract key facts on agent_end and write to MEMORY.md / scratchpad."""

    async def on_agent_end(self, final_text: str, session: Any) -> None:
        try:
            chat_history = getattr(session, "chat_history", None) or []
            if len(chat_history) < MIN_CHAT_TURNS * 2:
                return
            workspace_dir = getattr(session, "workspace_dir", None)
            if not workspace_dir:
                workspace_dir = os.getenv("AGX_WORKSPACE_ROOT", "") or str(Path.home())
            workspace_dir = Path(workspace_dir)

            facts = self._extract_facts_heuristic(chat_history)
            if not facts:
                return

            self._append_to_memory(workspace_dir, facts)
            self._maybe_compact_daily(workspace_dir)
            scratchpad = getattr(session, "scratchpad", None)
            if isinstance(scratchpad, dict):
                existing = scratchpad.get("session_facts", "")
                scratchpad["session_facts"] = (existing + "\n" + "\n".join(facts)).strip()
        except Exception:
            logger.debug("MemoryHook.on_agent_end failed silently", exc_info=True)

    def _extract_facts_heuristic(self, chat_history: list[dict]) -> list[str]:
        """Simple heuristic extraction without LLM call."""
        facts: list[str] = []
        for msg in chat_history[-20:]:
            role = str(msg.get("role", ""))
            content = str(msg.get("content", ""))
            if role == "user" and len(content) > 30:
                first_line = content.split("\n")[0].strip()[:200]
                if any(kw in first_line for kw in ("请", "帮", "要", "需要", "希望", "如何", "怎么")):
                    facts.append(f"- 用户请求: {first_line}")
            if role == "assistant" and ("已完成" in content or "done" in content.lower()):
                snippet = content[:200].replace("\n", " ").strip()
                facts.append(f"- 完成事项: {snippet}")
        return facts[:MAX_FACTS_PER_SESSION]

    def _append_to_memory(self, workspace_dir: Path, facts: list[str]) -> None:
        memory_dir = workspace_dir / "memory"
        memory_dir.mkdir(parents=True, exist_ok=True)
        daily_path = memory_dir / f"{date.today().isoformat()}.md"

        header = f"## Session Facts ({date.today().isoformat()})\n"
        block = header + "\n".join(facts) + "\n\n"

        existing = ""
        if daily_path.exists():
            existing = daily_path.read_text(encoding="utf-8")
        if len(existing) + len(block) > 8000:
            return
        with open(daily_path, "a", encoding="utf-8") as fh:
            fh.write(block)

        long_term = workspace_dir / "MEMORY.md"
        if long_term.exists():
            lt_content = long_term.read_text(encoding="utf-8")
            if len(lt_content) < 4000:
                with open(long_term, "a", encoding="utf-8") as fh:
                    fh.write(f"\n## Auto-extracted ({date.today().isoformat()})\n")
                    for fact in facts[:4]:
                        fh.write(f"{fact}\n")

    def _maybe_compact_daily(self, workspace_dir: Path) -> None:
        """Compact today's daily memory if it exceeds 2000 chars."""
        daily_path = workspace_dir / "memory" / f"{date.today().isoformat()}.md"
        if not daily_path.exists():
            return
        content = daily_path.read_text(encoding="utf-8")
        if len(content) <= 2000:
            return
        lines = content.strip().split("\n")
        kept: list[str] = []
        seen_facts: set[str] = set()
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("##"):
                kept.append(stripped)
                continue
            if stripped.startswith("- "):
                key = stripped[:80].lower()
                if key in seen_facts:
                    continue
                seen_facts.add(key)
            kept.append(stripped)
        compacted = "\n".join(kept).strip() + "\n"
        if len(compacted) < len(content):
            daily_path.write_text(compacted, encoding="utf-8")
