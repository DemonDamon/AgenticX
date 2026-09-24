#!/usr/bin/env python3
"""Optional heading-aware chunking and parent-child indexing units.

Author: Damon Li
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Dict, List, Optional

from .contracts import ChunkingSpec

_HEADING = re.compile(r"^(#{1,6})[ \t]+\S", re.MULTILINE)


def split_document(text: str, spec: ChunkingSpec, *, document_id: str) -> List[Dict[str, Any]]:
    """Split ``text`` into indexable chunks.

    ``strategy=auto`` tries a heading tier, then the caller-supplied recursive
    fallback, then a last-resort naive split. Parent chunks are marked
    ``chunk_role=parent`` and are not meant to be embedded.
    """

    if spec.parent_child:
        parent_size = int(spec.parent_chunk_size or 4096)
        child_size = int(spec.child_chunk_size or 384)
        parents = _split_tier(text, spec, chunk_size=parent_size, overlap=int(spec.chunk_overlap))
        out: List[Dict[str, Any]] = []
        child_seq = 0
        for parent_index, parent in enumerate(parents):
            parent_id = f"{document_id}::p{parent_index:04d}"
            parent_body = str(parent.get("text") or "")
            children = _split_tier(
                parent_body,
                spec,
                chunk_size=child_size,
                overlap=max(0, child_size // 5),
            )
            if not children:
                children = [{"text": parent_body, "start_index": 0, "end_index": len(parent_body)}]
            child_rows: List[Dict[str, Any]] = []
            for child in children:
                header = _merge_header(parent.get("context_header"), child.get("context_header"))
                body = str(child.get("text") or "")
                row = {
                    "text": body,
                    "embed_text": _embed_text(header, body),
                    "context_header": header,
                    "chunk_index": child_seq,
                    "start_index": _offset(parent.get("start_index"), child.get("start_index")),
                    "end_index": _offset(parent.get("start_index"), child.get("end_index")),
                    "chunk_role": "child",
                    "parent_id": parent_id,
                }
                child_rows.append(row)
                child_seq += 1
            out.append(
                {
                    "text": parent_body,
                    "embed_text": parent_body,
                    "context_header": parent.get("context_header") or "",
                    "chunk_index": parent_index,
                    "start_index": parent.get("start_index"),
                    "end_index": parent.get("end_index"),
                    "chunk_role": "parent",
                    "parent_id": parent_id,
                    "child_texts": [row["text"] for row in child_rows],
                }
            )
            out.extend(child_rows)
        return out

    rows = _split_tier(text, spec, chunk_size=int(spec.chunk_size), overlap=int(spec.chunk_overlap))
    for idx, row in enumerate(rows):
        header = str(row.get("context_header") or "")
        body = str(row.get("text") or "")
        row["chunk_index"] = idx
        row["embed_text"] = _embed_text(header, body)
        row.setdefault("context_header", "")
    return rows


def _split_tier(text: str, spec: ChunkingSpec, *, chunk_size: int, overlap: int) -> List[Dict[str, Any]]:
    strategy = (spec.strategy or "recursive").strip().lower()
    size = max(64, int(chunk_size))
    chain = ["heading", "recursive", "naive"] if strategy == "auto" else ["recursive", "naive"]
    if strategy == "heading":
        chain = ["heading", "naive"]
    last: List[Dict[str, Any]] = []
    for index, tier in enumerate(chain):
        produced = _run_tier(tier, text, size, overlap)
        last = produced
        if index == len(chain) - 1:
            return produced
        if _chunks_ok(produced, text, size):
            return produced
    return last


def _run_tier(tier: str, text: str, chunk_size: int, overlap: int) -> List[Dict[str, Any]]:
    if tier == "heading":
        return _split_headings(text, chunk_size)
    if tier == "recursive":
        return _split_recursive(text, chunk_size, overlap)
    return _naive(text, chunk_size, overlap)


def _split_headings(text: str, chunk_size: int) -> List[Dict[str, Any]]:
    matches = list(_HEADING.finditer(text))
    if len(matches) < 3:
        return []
    levels = [len(match.group(1)) for match in matches]
    dominant = Counter(levels).most_common(1)[0][0]
    if dominant <= 0:
        return []
    bounds = [match.start() for match in matches if len(match.group(1)) <= dominant]
    if not bounds:
        return []
    if bounds[0] != 0:
        bounds = [0, *bounds]
    bounds.append(len(text))
    crumbs: List[str] = []
    chunks: List[Dict[str, Any]] = []
    for start, end in zip(bounds, bounds[1:]):
        piece = text[start:end]
        if not piece.strip():
            continue
        first = piece.splitlines()[0].strip()
        heading = _HEADING.match(first)
        if heading is not None:
            level = len(heading.group(1))
            title = first[level:].strip()
            crumbs = crumbs[: level - 1]
            crumbs.append(title)
        body_start = 0
        if piece.startswith("#"):
            newline = piece.find("\n")
            body_start = 0 if newline < 0 else newline + 1
        body = piece[body_start:]
        chunks.append(
            {
                "text": body if body.strip() else piece,
                "context_header": "\n".join(crumbs),
                "start_index": start + (body_start if body.strip() else 0),
                "end_index": end,
            }
        )
    return chunks


def _split_recursive(text: str, chunk_size: int, overlap: int) -> List[Dict[str, Any]]:
    try:
        from agenticx.knowledge.base import ChunkingConfig
        from agenticx.knowledge.chunkers import get_chunker

        config = ChunkingConfig(chunk_size=chunk_size, chunk_overlap=overlap)
        raw = get_chunker("recursive", config=config).chunk_text(text)
    except Exception:
        return []
    return [_normalize_raw(item) for item in raw if _normalize_raw(item).get("text")]


def _naive(text: str, chunk_size: int, overlap: int) -> List[Dict[str, Any]]:
    size = max(64, chunk_size)
    step = max(1, size - max(0, min(size - 1, overlap)))
    chunks: List[Dict[str, Any]] = []
    index = 0
    while index < len(text):
        end = min(len(text), index + size)
        chunks.append({"text": text[index:end], "start_index": index, "end_index": end, "context_header": ""})
        if end >= len(text):
            break
        index += step
    return chunks


def _chunks_ok(chunks: List[Dict[str, Any]], text: str, chunk_size: int) -> bool:
    if not chunks:
        return False
    total = len(text)
    if len(chunks) == 1 and total > 2 * chunk_size:
        return False
    lengths = [len(str(chunk.get("text") or "")) for chunk in chunks]
    if max(lengths) > 2 * chunk_size:
        return False
    if max(lengths) < chunk_size / 4 and total > chunk_size:
        return False
    tiny = sum(1 for index, length in enumerate(lengths[:-1]) if length < 50)
    if tiny > len(chunks) / 4 and tiny > 2:
        return False
    return True


def _normalize_raw(item: Any) -> Dict[str, Any]:
    if isinstance(item, dict):
        text = str(item.get("content") or item.get("text") or "")
        start = item.get("start_index", item.get("start"))
        end = item.get("end_index", item.get("end"))
    elif hasattr(item, "content"):
        text = str(getattr(item, "content"))
        start = getattr(item, "start_index", None)
        end = getattr(item, "end_index", None)
    else:
        text = str(item)
        start = None
        end = None
    return {
        "text": text.strip(),
        "start_index": start if isinstance(start, int) else None,
        "end_index": end if isinstance(end, int) else None,
        "context_header": "",
    }


def _merge_header(parent: Optional[str], child: Optional[str]) -> str:
    parent_text = (parent or "").strip()
    child_text = (child or "").strip()
    if not parent_text:
        return child_text
    if not child_text:
        return parent_text
    parent_lines = parent_text.split("\n")
    child_lines = child_text.split("\n")
    if parent_lines[-1].strip() == child_lines[0].strip():
        child_lines = child_lines[1:]
    if not child_lines:
        return parent_text
    return parent_text + "\n" + "\n".join(child_lines)


def _embed_text(header: str, body: str) -> str:
    if not header:
        return body
    return f"{header}\n\n{body}"


def _offset(parent_start: Any, child_pos: Any) -> Optional[int]:
    if not isinstance(child_pos, int):
        return None
    if not isinstance(parent_start, int):
        return child_pos
    return parent_start + child_pos
