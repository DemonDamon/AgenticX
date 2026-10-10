#!/usr/bin/env python3
"""Structured wiki page model for brain-side incremental compilation (SP31).

Ported from the SP30b experience-wiki engine (envharness) and adapted to the
brain page contract: pages carry YAML frontmatter (title/type/description/
sources), a `## 要点` section of provenance-tagged claims, an optional
`## 矛盾` section of kept conflicting claims, and a rebuilt `## 来源` section.

Author: Damon Li
"""

from __future__ import annotations
import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import yaml


class MissingSourceError(ValueError):
    """A claim without provenance must never be written (never-invent gate)."""


@dataclass
class Claim:
    """One evidence-grounded statement; `sources` are REQUIRED provenance ids
    (source document names / trace ids) — never invented."""

    text: str
    sources: List[str]

    def __post_init__(self):
        self.text = (self.text or "").strip()
        self.sources = [s.strip() for s in self.sources if s and s.strip()]
        if not self.text:
            raise ValueError("claim text must be non-empty")
        if not self.sources:
            raise MissingSourceError(
                f"claim rejected (no provenance): {self.text[:80]!r}")

    def key(self) -> str:
        norm = unicodedata.normalize("NFKC", self.text).lower()
        return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", norm)


# Page types known to the brain wiki layout (wiki_compiler dirs + extensions).
PAGE_TYPES = ("entity", "concept", "method", "analysis", "synthesis",
              "comparison", "summary", "source", "index")
TYPE_DIR = {
    "entity": "entities",
    "concept": "concepts",
    "method": "method",
    "analysis": "analysis",
    "synthesis": "synthesis",
    "comparison": "comparison",
    "summary": "summary",
    "source": "sources",
    "index": "",
}

PAGE_STATUS_ACTIVE = "active"
PAGE_STATUS_CONTRADICTED = "contradicted"

_POINT_HEAD = re.compile(r"^##\s*要点\s*$", re.MULTILINE)
_CONTRA_HEAD = re.compile(r"^##\s*矛盾\s*$", re.MULTILINE)
_NEXT_HEAD = re.compile(r"^##\s+", re.MULTILINE)
_CLAIM_RE = re.compile(r"^-\s+(.+?)（来源:\s*(.+?)）\s*$")
_PLAIN_SCALAR = re.compile(r"^[A-Za-z0-9_./:@#-]+$")


def slugify(title: str) -> str:
    s = unicodedata.normalize("NFKC", title).lower()
    s = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", s).strip("-")
    return re.sub(r"-{2,}", "-", s)[:80]


def _yaml_scalar(s: str) -> str:
    if _PLAIN_SCALAR.fullmatch(s):
        return s
    return json.dumps(s, ensure_ascii=False)


@dataclass
class WikiPage:
    page_type: str
    title: str
    description: str = ""
    claims: List[Claim] = field(default_factory=list)
    contradiction_claims: List[Claim] = field(default_factory=list)
    sources: List[str] = field(default_factory=list)
    status: str = PAGE_STATUS_ACTIVE
    source_path: str = ""           # storage-relative, set on parse

    def __post_init__(self):
        # Types outside PAGE_TYPES are tolerated: LLM output may use other
        # labels, and Near's browse UI already degrades unknown types to the
        # default color. Only an empty type is normalized.
        self.page_type = (self.page_type or "concept").strip() or "concept"

    # ----- parse -----

    @classmethod
    def parse(cls, markdown: str, source_path: str = "") -> "WikiPage":
        """Parse a structured page. Raises ValueError when the page has no
        frontmatter (legacy free-form page — callers must not treat legacy
        pages as mergeable)."""
        m = re.match(r"^---\n(.*?)\n---\n", markdown, re.DOTALL)
        if not m:
            raise ValueError(f"no frontmatter in {source_path!r}")
        fm = yaml.safe_load(m.group(1)) or {}
        page = cls(
            page_type=str(fm.get("type") or "concept"),
            title=str(fm.get("title") or ""),
            description=str(fm.get("description") or ""),
            status=str(fm.get("status") or PAGE_STATUS_ACTIVE),
            source_path=source_path,
        )
        raw_sources = fm.get("sources") or []
        if isinstance(raw_sources, str):
            raw_sources = [raw_sources]
        page.sources = [str(s) for s in raw_sources]

        # Walk body sections; collect provenance-tagged bullets from 要点 and
        # 矛盾 respectively.
        body = markdown[m.end():]
        section = ""
        for line in body.splitlines():
            if _POINT_HEAD.match(line):
                section = "points"
                continue
            if _CONTRA_HEAD.match(line):
                section = "contradictions"
                continue
            if _NEXT_HEAD.match(line):
                section = ""
                continue
            mc = _CLAIM_RE.match(line.strip())
            if not mc:
                continue
            try:
                claim = Claim(text=mc.group(1),
                              sources=[s.strip() for s in
                                       mc.group(2).split(",")])
            except (ValueError, MissingSourceError):
                continue
            if section == "points":
                page.claims.append(claim)
            elif section == "contradictions":
                page.contradiction_claims.append(claim)
        return page

    # ----- render -----

    def merged_sources(self) -> List[str]:
        out: List[str] = list(self.sources)
        for c in list(self.claims) + list(self.contradiction_claims):
            for s in c.sources:
                if s not in out:
                    out.append(s)
        return out

    def render(self) -> str:
        all_srcs = self.merged_sources()
        status = (PAGE_STATUS_CONTRADICTED if self.contradiction_claims
                  else self.status)
        fm = {
            "type": self.page_type,
            "title": self.title,
            "description": self.description,
            "status": status,
        }
        # width=4096 + hand-written `sources` block: both required by the
        # line-level frontmatter regexes in wiki_ops / wiki_graph.
        fm_dump = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False,
                                 default_flow_style=False,
                                 width=4096).rstrip("\n")
        if all_srcs:
            fm_dump += "\nsources:\n" + "".join(
                f"  - {_yaml_scalar(s)}\n" for s in all_srcs)
        lines = ["---", fm_dump.rstrip("\n"), "---", "",
                 f"# {self.title}", ""]
        if self.description:
            lines += [self.description, ""]
        lines += ["## 要点", ""]
        for c in self.claims:
            lines.append(f"- {c.text}（来源: {', '.join(c.sources)}）")
        lines.append("")
        if self.contradiction_claims:
            lines += ["## 矛盾", "",
                      "以下结论互斥，适用条件不同或证据冲突，均已保留：", ""]
            for c in self.contradiction_claims:
                lines.append(f"- {c.text}（来源: {', '.join(c.sources)}）")
            lines.append("")
        if all_srcs:
            lines += ["## 来源", ""]
            lines += [f"- {s}" for s in all_srcs] + [""]
        return "\n".join(lines).rstrip("\n") + "\n"
