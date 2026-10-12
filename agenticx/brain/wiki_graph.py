#!/usr/bin/env python3
"""Wiki graph retrieval for compiled brain pages.

Author: Damon Li
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from agenticx.studio.kb.contracts import RetrievalHit, RetrievalHitSource

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


def wiki_graph_payload(brain_kb_dir: Path) -> Dict[str, Any]:
    """Serialize compiled wiki pages and wikilink edges for the browse UI."""
    graph = build_wiki_graph(brain_kb_dir)
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, str]] = []
    for node_id in sorted(graph.nodes):
        node = graph.nodes[node_id]
        nodes.append(
            {
                "id": node.node_id,
                "title": node.title,
                "type": node.page_type,
                "path": node.path,
                "sources": list(node.sources),
            }
        )
        for target in sorted(node.out_links):
            edges.append({"source": node.node_id, "target": target})
    return {"nodes": nodes, "edges": edges}


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


_QUERY_STOP = {
    "什么", "怎么", "如何", "为啥", "这个", "那个", "一下", "东西", "过程",
    "关于", "我们", "你们", "他们", "是否", "可以", "咋样", "没有", "不是",
    "说了", "关于",
}
# Glue inside a question. Grams that contain these are splits like 「了关于本」, not page titles.
_QUERY_GLUE = set("的了是在被把对从这那说呢吗吧啊呀过程关於于东西怎样什咋")


def _query_terms(query: str) -> List[str]:
    """Terms that can identify a wiki page. Longer phrases stay ahead of bigrams."""
    terms: List[str] = []
    for word in re.findall(r"[A-Za-z][A-Za-z0-9_+.-]{2,}", query or ""):
        terms.append(word.lower())
    cjk = "".join(re.findall(r"[\u4e00-\u9fff]", query or ""))
    for size in (4, 3, 2):
        for index in range(0, max(0, len(cjk) - size + 1)):
            gram = cjk[index : index + size]
            if gram in _QUERY_STOP or any(ch in _QUERY_GLUE for ch in gram):
                continue
            terms.append(gram)
    seen: Set[str] = set()
    ordered: List[str] = []
    for term in terms:
        if term in seen:
            continue
        seen.add(term)
        ordered.append(term)
    return ordered[:48]


def _overlap_score(text: str, terms: List[str]) -> float:
    lowered = (text or "").lower()
    if not lowered:
        return 0.0
    score = 0.0
    matched: Set[str] = set()
    for term in terms:
        key = term.lower()
        if key in matched or key not in lowered:
            continue
        matched.add(key)
        score += float(len(term))
    return score


def _page_text(brain_kb_dir: Path, node: WikiNode) -> str:
    wiki_path = brain_kb_dir / node.path
    if not wiki_path.is_file():
        return ""
    try:
        return wiki_path.read_text(encoding="utf-8", errors="replace")[:1500]
    except OSError:
        return ""


def expand_hits_with_wiki_graph(
    brain_kb_dir: Path,
    *,
    query: str,
    hits: List[RetrievalHit],
    top_k: int,
) -> List[RetrievalHit]:
    """Append wiki pages whose titles match the query, plus one hop of their links.

    Pages are chosen from the question, not from the source filename. A neighbor
    is kept only when its title or body also overlaps the question, so a lecture
    that mentions several topics does not drag in the best-connected cluster.
    """
    graph = build_wiki_graph(brain_kb_dir)
    if not graph.nodes or not hits:
        return hits
    terms = _query_terms(query)
    if not terms:
        return hits

    seed_ids = [
        nid
        for nid, node in graph.nodes.items()
        if _overlap_score(f"{node.title}\n{nid}", terms) > 0
    ]
    if not seed_ids:
        return hits

    candidate_ids: Set[str] = set(seed_ids)
    for sid in seed_ids:
        candidate_ids.update(graph.nodes[sid].out_links)

    pages: List[Tuple[WikiNode, str]] = []
    for nid in candidate_ids:
        node = graph.nodes.get(nid)
        if node is None or str(node.page_type or "").startswith("source"):
            continue
        text = _page_text(brain_kb_dir, node)
        if not text:
            continue
        pages.append((node, text))
    if not pages:
        return hits

    # A word printed on every related page (讲者名、讲座名) does not say which page answers the question.
    useful_terms = []
    for term in terms:
        present = 0
        titled = 0
        for node, text in pages:
            blob = f"{node.title}\n{node.node_id}\n{text}".lower()
            if term.lower() in blob:
                present += 1
            if term.lower() in f"{node.title}\n{node.node_id}".lower():
                titled += 1
        if present == 0:
            continue
        if present == len(pages) and titled == 0:
            continue
        useful_terms.append(term)
    if not useful_terms:
        return hits

    ranked: List[Tuple[float, str, str]] = []
    for node, text in pages:
        title_score = _overlap_score(f"{node.title}\n{node.node_id}", useful_terms)
        body_score = _overlap_score(text, useful_terms)
        if title_score <= 0 and body_score <= 0:
            continue
        ranked.append((title_score * 3.0 + body_score, node.node_id, text))
    ranked.sort(key=lambda item: item[0], reverse=True)

    best_chunk = max((float(hit.score) for hit in hits), default=0.5)
    extras: List[RetrievalHit] = []
    for match_score, nid, text in ranked:
        if len(extras) >= 3:
            break
        node = graph.nodes[nid]
        if any(nid in (hit.source.title or "") or nid in hit.source.uri for hit in hits):
            continue
        # Stay near the chunk scores. A graph weight of 7 used to outrank the slides.
        score = max(0.01, best_chunk * 0.85) + min(match_score, 8.0) * 0.01
        extras.append(
            RetrievalHit(
                id=f"wiki::{nid}",
                score=score,
                text=text[:1200],
                source=RetrievalHitSource(
                    kind="local",
                    uri=str(brain_kb_dir / node.path),
                    title=node.title,
                ),
                metadata={
                    "retrieval_mode": "wiki_graph",
                    "graph_boost": float(match_score),
                    "wiki_page": node.path,
                },
            )
        )
    _ = top_k
    return list(hits) + extras
