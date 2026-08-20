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

    def inject(
        self,
        base_prompt: str,
        skill_summaries: list[dict[str, Any]],
        *,
        include_catalog: bool = True,
    ) -> str:
        """Append protocol and (optionally) available skill summaries to prompt text.

        ``include_catalog=False`` 只追加协议正文，不再追加技能目录。元智能体走的就
        是这条路：它的 system prompt 里本来已经有一份 ``### Skills（共 N 个）``，
        这里再追加一份 ``## Available Skills`` 就是**同样 22 个技能、同样的描述，
        原样列了两遍**——实测 4770 + 5013 = 9783 字符（约 2795 token），其中一半
        是纯重复。现在目录只渲染一次，并且跟着其它易变状态搬到了对话末尾的
        ``<session-context>``（见 ``agenticx.runtime.prompts.session_context``）。
        """
        if not self.enabled:
            return base_prompt
        if not include_catalog:
            return f"{base_prompt}\n\n{USING_AGENTICX_SKILL}\n"
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
