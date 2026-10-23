#!/usr/bin/env python3
"""Case entry data model — pure Markdown + YAML frontmatter (decision D1).

A case-entry is the precipitated knowledge unit of the B-side case library:
frontmatter carries the retrieval fields (case_id/scope/lifecycle/provenance),
the body carries L1 narrative sections (问题/方案/结果).

Author: Damon Li
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# Page-type taxonomy is aligned with brain/wiki/page.py; "case" is new.
CASE_SCHEMA_VERSION = 1

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)
_SECTION_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)


@dataclass
class CaseEntry:
    """One case-library entry (render → cases/{org}/{domain}/{slug}.md)."""

    case_id: str
    title: str
    type: str = "case"                      # aligned with wiki page types, new "case"
    summary: str = ""                       # L0: ≤256 char retrieval summary
    problem: str = ""                       # L1: problem background
    solution: str = ""                       # L1: solution overview (key decisions)
    outcome: str = ""                       # L1: outcome (before/after metrics)
    artifacts: list[str] = field(default_factory=list)   # L2: wiki/skills/spec/evals rel paths
    scope: dict[str, str] = field(default_factory=dict)  # domain/team_size/model_requirement/constraints
    lifecycle_status: str = "active"        # active | superseded | deprecated
    supersedes: list[str] = field(default_factory=list)
    freshness: str = ""                     # ISO date, last update
    provenance: dict[str, str] = field(default_factory=dict)  # project_ref/trajectory_ref/compiler_version
    verification: dict[str, str] = field(default_factory=dict)  # eval_passed/redline_check/reviewer


def case_frontmatter(entry: CaseEntry) -> str:
    """Render the YAML frontmatter block (without --- fences)."""
    fm: dict[str, Any] = {
        "schema_version": CASE_SCHEMA_VERSION,
        "case_id": entry.case_id,
        "title": entry.title,
        "type": entry.type or "case",
        "summary": entry.summary,
        "artifacts": list(entry.artifacts),
        "scope": dict(entry.scope),
        "lifecycle_status": entry.lifecycle_status or "active",
        "supersedes": list(entry.supersedes),
        "freshness": entry.freshness,
        "provenance": dict(entry.provenance),
        "verification": dict(entry.verification),
    }
    dumped = yaml.safe_dump(
        fm,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=4096,
    )
    return dumped.rstrip("\n")


def render_case_md(entry: CaseEntry) -> str:
    """Render the full markdown doc: frontmatter + L1 body sections."""
    lines = [
        "---",
        case_frontmatter(entry),
        "---",
        "",
        f"# {entry.title}",
        "",
        "## 问题",
        "",
        entry.problem or "(待补充)",
        "",
        "## 方案",
        "",
        entry.solution or "(待补充)",
        "",
        "## 结果",
        "",
        entry.outcome or "(待补充)",
        "",
    ]
    return "\n".join(lines)


def _extract_section(body: str, heading: str) -> str:
    """Extract the text between `## {heading}` and the next `## ` heading."""
    pattern = rf"^##\s+{re.escape(heading)}\s*\n(.*?)(?=^##\s+|\Z)"
    m = re.search(pattern, body, re.DOTALL | re.MULTILINE)
    if not m:
        return ""
    return m.group(1).strip()


def _str_dict(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items()}


def _str_list(raw: Any) -> list[str]:
    if isinstance(raw, str):
        return [raw]
    if not isinstance(raw, list):
        return []
    return [str(x) for x in raw]


def parse_case_md(path: Path) -> CaseEntry:
    """Parse a case-entry file. Unknown frontmatter fields are tolerated
    (backward compatibility: newer writers may add fields)."""
    text = Path(path).read_text(encoding="utf-8")
    m = _FRONTMATTER_RE.match(text)
    if not m:
        raise ValueError(f"no frontmatter in case-entry {str(path)!r}")
    fm = yaml.safe_load(m.group(1)) or {}
    if not isinstance(fm, dict):
        raise ValueError(f"malformed frontmatter in case-entry {str(path)!r}")

    body = text[m.end():]
    return CaseEntry(
        case_id=str(fm.get("case_id") or ""),
        title=str(fm.get("title") or ""),
        type=str(fm.get("type") or "case"),
        summary=str(fm.get("summary") or ""),
        problem=_extract_section(body, "问题"),
        solution=_extract_section(body, "方案"),
        outcome=_extract_section(body, "结果"),
        artifacts=_str_list(fm.get("artifacts")),
        scope=_str_dict(fm.get("scope")),
        lifecycle_status=str(fm.get("lifecycle_status") or "active"),
        supersedes=_str_list(fm.get("supersedes")),
        freshness=str(fm.get("freshness") or ""),
        provenance=_str_dict(fm.get("provenance")),
        verification=_str_dict(fm.get("verification")),
    )
