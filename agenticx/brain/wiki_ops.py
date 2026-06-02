#!/usr/bin/env python3
"""Wiki compile orchestration and maintenance helpers for docs brains.

Author: Damon Li
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.brain.wiki_compiler import WikiCompiler
from agenticx.studio.kb.contracts import IngestJobStatus

logger = logging.getLogger(__name__)

_FM_BLOCK = re.compile(r"^---\n([\s\S]*?)\n---", re.MULTILINE)


def brain_storage_root(brain) -> Path:
    return Path(str(brain.storage_root)).expanduser()


def list_wiki_pages(brain_storage: Path) -> List[Dict[str, Any]]:
    wiki_root = brain_storage / "wiki"
    if not wiki_root.is_dir():
        return []
    pages: List[Dict[str, Any]] = []
    for path in sorted(wiki_root.rglob("*.md")):
        rel = str(path.relative_to(brain_storage)).replace("\\", "/")
        title = path.stem
        page_type = "page"
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
            fm = _FM_BLOCK.match(text)
            if fm:
                block = fm.group(1)
                tm = re.search(r"^title:\s*[\"']?(.+?)[\"']?\s*$", block, re.MULTILINE)
                ty = re.search(r"^type:\s*[\"']?(.+?)[\"']?\s*$", block, re.MULTILINE)
                if tm:
                    title = tm.group(1).strip()
                if ty:
                    page_type = ty.group(1).strip()
        except OSError:
            pass
        pages.append({"path": rel, "title": title, "type": page_type})
    return pages


def read_wiki_page(brain_storage: Path, rel_path: str) -> Optional[str]:
    rel = rel_path.strip().lstrip("/").replace("\\", "/")
    if not rel.startswith("wiki/"):
        rel = f"wiki/{rel}"
    target = (brain_storage / rel).resolve()
    try:
        target.relative_to(brain_storage.resolve())
    except ValueError:
        return None
    if not target.is_file():
        return None
    return target.read_text(encoding="utf-8", errors="replace")


def purge_wiki_source(brain_storage: Path, source_name: str) -> List[str]:
    """Remove compiled wiki pages tied to a material source file."""
    wiki_root = brain_storage / "wiki"
    if not wiki_root.is_dir():
        return []
    removed: List[str] = []
    stem = Path(source_name).stem
    candidates = [
        wiki_root / "sources" / f"{stem}.md",
        wiki_root / "sources" / f"{source_name}.md",
    ]
    for path in candidates:
        if path.is_file():
            try:
                path.unlink()
                removed.append(str(path.relative_to(brain_storage)).replace("\\", "/"))
            except OSError as exc:
                logger.warning("failed to remove wiki page %s: %s", path, exc)

    for path in list(wiki_root.rglob("*.md")):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        fm = _FM_BLOCK.match(text)
        if not fm:
            continue
        block = fm.group(1)
        if source_name in block or stem in block:
            if any(
                line.strip().endswith(source_name) or line.strip().endswith(stem)
                for line in block.splitlines()
                if line.strip().startswith("- ")
            ):
                try:
                    path.unlink()
                    rel = str(path.relative_to(brain_storage)).replace("\\", "/")
                    if rel not in removed:
                        removed.append(rel)
                except OSError as exc:
                    logger.warning("failed to remove wiki page %s: %s", path, exc)
    return removed


def maybe_compile_wiki_after_ingest(docs_rt, job) -> None:
    """Background callback after ingest job completes."""
    if getattr(job, "status", None) != IngestJobStatus.DONE:
        return
    doc_id = getattr(job, "document_id", None)
    if not doc_id:
        return
    cfg = docs_rt.read_config()
    if not getattr(getattr(cfg, "wiki_compiler", None), "enabled", False):
        return
    doc = docs_rt.runtime.get_document(doc_id)
    if doc is None:
        return
    try:
        from agenticx.studio.kb.runtime import _read_document_text

        text = _read_document_text(doc.source_path)
    except Exception as exc:
        logger.warning("wiki compile skipped, cannot read source: %s", exc)
        return
    storage = brain_storage_root(docs_rt.brain)
    compiler = WikiCompiler(storage)
    result = compiler.compile_source(
        source_path=doc.source_path,
        source_text=text,
        provider_name=cfg.embedding.provider,
        model_name=None,
    )
    if not result.ok:
        logger.warning("wiki compile failed for %s: %s", doc_id, result.error)
    else:
        logger.info("wiki compile wrote %d pages for %s", len(result.written), doc_id)
    try:
        docs_rt.refresh_brain_stats()
    except Exception:
        pass


def run_brain_maintenance(docs_rt) -> Dict[str, Any]:
    """Lightweight maintenance: orphan wiki report + broken wikilink lint."""
    storage = brain_storage_root(docs_rt.brain)
    wiki_root = storage / "wiki"
    report: Dict[str, Any] = {
        "ok": True,
        "orphan_pages": [],
        "broken_wikilinks": [],
        "stale_embed_hint": False,
    }
    if not wiki_root.is_dir():
        return report

    from agenticx.brain.wiki_graph import build_wiki_graph

    graph = build_wiki_graph(storage)
    known = set(graph.nodes.keys())
    wikilink = re.compile(r"\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]")

    for path in wiki_root.rglob("*.md"):
        rel = str(path.relative_to(storage)).replace("\\", "/")
        node_id = rel.replace("wiki/", "").replace(".md", "").replace("\\", "/")
        if node_id not in known and rel != "wiki/index.md":
            report["orphan_pages"].append(rel)
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in wikilink.finditer(text):
            target = m.group(1).strip().replace(" ", "-").lower()
            if target and target not in known:
                report["broken_wikilinks"].append({"page": rel, "link": m.group(1)})

    stats = docs_rt.stats()
    report["stale_embed_hint"] = bool(stats.get("rebuild_required"))
    return report
