#!/usr/bin/env python3
"""Wiki graph retrieval for compiled brain pages.

Author: Damon Li
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from agenticx.studio.kb.contracts import RetrievalHit

_WIKILINK = re.compile(r"\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]")
_FM_BLOCK = re.compile(r"^---\n([\s\S]*?)\n---", re.MULTILINE)

WEIGHTS = {
    "direct_link": 3.0,
    "source_overlap": 4.0,
    "common_neighbor": 1.5,
    "type_affinity": 1.0,
}


@dataclass
class WikiNode:
    node_id: str
    title: str
    page_type: str
    path: str
    sources: List[str] = field(default_factory=list)
    out_links: Set[str] = field(default_factory=set)
    in_links: Set[str] = field(default_factory=set)


@dataclass
class WikiGraph:
    nodes: Dict[str, WikiNode] = field(default_factory=dict)


def _parse_frontmatter(content: str) -> Dict[str, Any]:
    m = _FM_BLOCK.match(content)
    if not m:
        return {}
    fm = m.group(1)
    out: Dict[str, Any] = {}
    title_m = re.search(r"^title:\s*[\"']?(.+?)[\"']?\s*$", fm, re.MULTILINE)
    type_m = re.search(r"^type:\s*[\"']?(.+?)[\"']?\s*$", fm, re.MULTILINE)
    if title_m:
        out["title"] = title_m.group(1).strip()
    if type_m:
        out["type"] = type_m.group(1).strip()
    sources: List[str] = []
    block = re.search(r"^sources:\s*\n((?:\s+-\s+.+\n?)*)", fm, re.MULTILINE)
    if block:
        for line in block.group(1).splitlines():
            item = re.match(r"^\s+-\s+[\"']?(.+?)[\"']?\s*$", line)
            if item:
                sources.append(item.group(1).strip())
    out["sources"] = sources
    return out


def _node_id_from_path(rel_path: str) -> str:
    base = rel_path.replace("\\", "/")
    if base.startswith("wiki/"):
        base = base[5:]
    if base.endswith(".md"):
        base = base[:-3]
    return base


def build_wiki_graph(brain_kb_dir: Path) -> WikiGraph:
    wiki_root = brain_kb_dir / "wiki"
    graph = WikiGraph()
    if not wiki_root.is_dir():
        return graph

    md_files: List[Path] = []
    for p in wiki_root.rglob("*.md"):
        if p.is_file():
            md_files.append(p)

    for path in md_files:
        rel = path.relative_to(brain_kb_dir).as_posix()
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        fm = _parse_frontmatter(content)
        node_id = _node_id_from_path(rel)
        graph.nodes[node_id] = WikiNode(
            node_id=node_id,
            title=str(fm.get("title") or node_id),
            page_type=str(fm.get("type") or "concept"),
            path=rel,
            sources=list(fm.get("sources") or []),
        )

    for path in md_files:
        rel = path.relative_to(brain_kb_dir).as_posix()
        node_id = _node_id_from_path(rel)
        node = graph.nodes.get(node_id)
        if node is None:
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for match in _WIKILINK.finditer(content):
            target = match.group(1).strip()
            target_id = target.replace(".md", "")
            if target_id in graph.nodes:
                node.out_links.add(target_id)
                graph.nodes[target_id].in_links.add(node_id)
    return graph


def _type_affinity(a: str, b: str) -> float:
    if a == b:
        return 0.8
    pairs = {("entity", "concept"), ("concept", "entity"), ("concept", "synthesis")}
    return 1.2 if (a, b) in pairs or (b, a) in pairs else 1.0


def calculate_relevance(source: WikiNode, target: WikiNode, graph: WikiGraph) -> float:
    score = 0.0
    if target.node_id in source.out_links or source.node_id in target.in_links:
        score += WEIGHTS["direct_link"]
    if source.sources and target.sources:
        overlap = set(source.sources) & set(target.sources)
        if overlap:
            score += WEIGHTS["source_overlap"] * min(1.0, len(overlap))
    common = source.out_links & target.out_links
    if common:
        score += WEIGHTS["common_neighbor"] * sum(
            1.0 / max(1, len(graph.nodes[n].out_links) + len(graph.nodes[n].in_links))
            for n in common
            if n in graph.nodes
        )
    score += WEIGHTS["type_affinity"] * _type_affinity(source.page_type, target.page_type) * 0.1
    return score


def expand_hits_with_wiki_graph(
    brain_kb_dir: Path,
    *,
    query: str,
    hits: List[RetrievalHit],
    top_k: int,
) -> List[RetrievalHit]:
    """Boost / append related wiki pages using graph signals."""
    _ = query
    graph = build_wiki_graph(brain_kb_dir)
    if not graph.nodes or not hits:
        return hits

    seed_ids: Set[str] = set()
    for hit in hits:
        uri = str(hit.source.uri or "")
        name = Path(uri).stem if uri else ""
        for nid, node in graph.nodes.items():
            if name and (name in node.title or name in nid or name in Path(node.path).stem):
                seed_ids.add(nid)
                break

    if not seed_ids and hits:
        seed_ids.add(next(iter(graph.nodes)))

    scored: Dict[str, float] = {}
    hit_by_id = {h.id: h for h in hits}
    for sid in seed_ids:
        source = graph.nodes.get(sid)
        if source is None:
            continue
        for nid, node in graph.nodes.items():
            rel = calculate_relevance(source, node, graph)
            if rel > 0:
                scored[nid] = max(scored.get(nid, 0.0), rel)

    boosted = list(hits)
    for hit in hits:
        meta = dict(hit.metadata)
        meta["graph_boost"] = meta.get("graph_boost", 0.0)
        hit.metadata = meta

    for nid, boost in sorted(scored.items(), key=lambda x: x[1], reverse=True):
        if any(nid in (h.source.title or "") or nid in h.source.uri for h in boosted):
            continue
        node = graph.nodes[nid]
        wiki_path = brain_kb_dir / node.path
        if not wiki_path.is_file():
            continue
        try:
            text = wiki_path.read_text(encoding="utf-8", errors="replace")[:1200]
        except OSError:
            continue
        from agenticx.studio.kb.contracts import RetrievalHitSource

        boosted.append(
            RetrievalHit(
                id=f"wiki::{nid}",
                score=float(boost),
                text=text,
                source=RetrievalHitSource(
                    kind="local",
                    uri=str(wiki_path),
                    title=node.title,
                ),
                metadata={
                    "retrieval_mode": "hybrid_graph",
                    "graph_boost": float(boost),
                    "wiki_page": node.path,
                },
            )
        )

    boosted.sort(key=lambda h: float(h.score), reverse=True)
    return boosted[:top_k]
