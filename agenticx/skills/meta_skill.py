#!/usr/bin/env python3
"""Meta skill protocol injection helpers.

Author: Damon Li
"""

from __future__ import annotations

import os
from typing import Any

USING_AGENTICX_SKILL = """
<skill-protocol>
## Skill-First Protocol (AgenticX)

You have access to Skills - reusable knowledge guides stored as SKILL.md files.

The 1% Rule: If there is even a 1% chance a skill applies, you MUST invoke it.
Invoke skills before any action, including clarifying questions.

Skill Priority:
1. User explicit instructions (AGENTS.md / chat)
2. Process skills (brainstorming, debugging, planning)
3. Implementation skills (domain patterns)
4. Default behavior

Red Flags (stop and invoke a skill instead):
- "This is a simple question" -> Questions are tasks. Check skills first.
- "I already know this pattern" -> Skills evolve. Read current version.
- "I will explore first" -> Skills define how to explore.

Skill Types:
- rigid: Follow exactly (for example TDD and debugging workflows)
- flexible: Adapt principles to context (for example reference patterns)
</skill-protocol>
""".strip()


class MetaSkillInjector:
    """Inject meta skill protocol into system prompts."""

    def __init__(self, enabled: bool | None = None) -> None:
        if enabled is None:
            flag = os.getenv("AGX_SKILL_PROTOCOL", "true").strip().lower()
            enabled = flag not in {"0", "false", "off", "no"}
        self.enabled = enabled

    def inject(self, base_prompt: str, skill_summaries: list[dict[str, Any]]) -> str:
        """Append protocol and available skill summaries to prompt text."""
        if not self.enabled:
            return base_prompt
        lines = ["## Available Skills"]
        if not skill_summaries:
            lines.append("- (no registered skills)")
        else:
            for skill in skill_summaries:
                name = str(skill.get("name", "")).strip() or "(unknown)"
                description = str(skill.get("description", "")).strip() or "(no description)"
                skill_type = str(skill.get("skill_type", "flexible")).strip() or "flexible"
                lines.append(f"- {name} [{skill_type}]: {description}")
        skill_block = "\n".join(lines)
        return f"{base_prompt}\n\n{USING_AGENTICX_SKILL}\n\n{skill_block}\n"
