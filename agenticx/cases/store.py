#!/usr/bin/env python3
"""CaseStore — case-entry persistence under cases/{org}/{domain}/{slug}.md.

Decision D5: directory layout is cases/{org}/{domain}/{slug}.md with
org="default" for V1. An on-disk index (cases/index.json) is rebuilt from
the markdown corpus on demand (compile-time index, decision D2).

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from agenticx.brain.wiki.page import slugify
from agenticx.cases.model import CASE_SCHEMA_VERSION, CaseEntry, parse_case_md

logger = logging.getLogger("agenticx.cases.store")

DEFAULT_ORG = "default"
DEFAULT_DOMAIN = "default"


class CaseStore:
    """Filesystem store over a `<workspace>/cases` root."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    # ----- paths -----

    def path_for(self, entry: CaseEntry) -> Path:
        """cases/{org}/{domain}/{slug}.md (org defaults to "default")."""
        org = (entry.scope.get("org") or DEFAULT_ORG).strip() or DEFAULT_ORG
        domain = (entry.scope.get("domain") or DEFAULT_DOMAIN).strip() or DEFAULT_DOMAIN
        slug = slugify(entry.title) or slugify(entry.case_id) or "case"
        return self.root / org / domain / f"{slug}.md"

    # ----- write -----

    def save(self, entry: CaseEntry) -> Path:
        from agenticx.cases.model import render_case_md

        path = self.path_for(entry)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_case_md(entry), encoding="utf-8")
        return path

    # ----- read -----

    def get(self, case_id: str) -> CaseEntry | None:
        for path in sorted(self.root.rglob("*.md")):
            try:
                entry = parse_case_md(path)
            except (OSError, ValueError) as exc:
                logger.debug("skipping non-case file %s: %s", path, exc)
                continue
            if entry.case_id == case_id:
                return entry
        return None

    def list_cases(self, *, domain: str | None = None, org: str = DEFAULT_ORG) -> list[CaseEntry]:
        base = self.root / org
        if domain:
            base = base / domain
        out: list[CaseEntry] = []
        if not base.is_dir():
            return out
        for path in sorted(base.rglob("*.md")):
            try:
                out.append(parse_case_md(path))
            except (OSError, ValueError) as exc:
                logger.debug("skipping non-case file %s: %s", path, exc)
                continue
        return out

    # ----- index -----

    def build_index(self) -> Path:
        """Rebuild cases/index.json: case_id → path/summary/scope."""
        cases: dict[str, dict[str, object]] = {}
        for path in sorted(self.root.rglob("*.md")):
            try:
                entry = parse_case_md(path)
            except (OSError, ValueError) as exc:
                logger.debug("skipping non-case file %s: %s", path, exc)
                continue
            cases[entry.case_id] = {
                "path": str(path.relative_to(self.root)),
                "summary": entry.summary,
                "scope": dict(entry.scope),
            }
        index = {
            "version": CASE_SCHEMA_VERSION,
            "cases": cases,
        }
        self.root.mkdir(parents=True, exist_ok=True)
        index_path = self.root / "index.json"
        index_path.write_text(
            json.dumps(index, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return index_path
