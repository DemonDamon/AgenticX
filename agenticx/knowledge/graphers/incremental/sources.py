"""Source document fingerprints and change detection for incremental graph sync."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Union

_DEFAULT_REL = Path(".runtime") / "graph-incremental"


def resolve_incremental_store_dir(root: Optional[Union[str, Path]] = None) -> Path:
    if root is not None:
        return Path(root)
    env = os.environ.get("AGX_GRAPH_INCREMENTAL_STORE_DIR", "").strip()
    if env:
        return Path(env)
    return Path.cwd() / _DEFAULT_REL


def content_hash(text: str) -> str:
    """Stable SHA-256 hex digest of UTF-8 source text."""
    data = (text if isinstance(text, str) else str(text)).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


@dataclass
class SourceDocument:
    id: str
    content: str
    content_hash: str = ""
    meta: Dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.id = str(self.id or "").strip()
        if not self.id:
            raise ValueError("SourceDocument.id is required")
        self.content = "" if self.content is None else str(self.content)
        self.meta = dict(self.meta or {})
        if not self.content_hash:
            self.content_hash = content_hash(self.content)
        else:
            self.content_hash = str(self.content_hash)

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "content": self.content,
            "content_hash": self.content_hash,
            "meta": dict(self.meta),
        }

    @classmethod
    def from_dict(cls, raw: Dict) -> "SourceDocument":
        if not isinstance(raw, dict):
            raise ValueError("source document must be a mapping")
        return cls(
            id=str(raw.get("id") or ""),
            content=str(raw.get("content") or ""),
            content_hash=str(raw.get("content_hash") or ""),
            meta=dict(raw.get("meta") or {}),
        )


@dataclass
class ChangeSet:
    added: List[str] = field(default_factory=list)
    changed: List[str] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)
    unchanged: List[str] = field(default_factory=list)

    @property
    def needs_extract(self) -> List[str]:
        return list(self.added) + list(self.changed)

    def to_dict(self) -> Dict:
        return {
            "added": list(self.added),
            "changed": list(self.changed),
            "removed": list(self.removed),
            "unchanged": list(self.unchanged),
        }


def _diff_maps(prior: Dict[str, str], current: Dict[str, str]) -> ChangeSet:
    added: List[str] = []
    changed: List[str] = []
    unchanged: List[str] = []
    removed: List[str] = []
    for sid, h in sorted(current.items()):
        if sid not in prior:
            added.append(sid)
        elif prior[sid] != h:
            changed.append(sid)
        else:
            unchanged.append(sid)
    for sid in sorted(prior):
        if sid not in current:
            removed.append(sid)
    return ChangeSet(added=added, changed=changed, removed=removed, unchanged=unchanged)


class SourceChangeTracker:
    """Persist source_id → content_hash fingerprints; compute ChangeSet vs incoming docs."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_incremental_store_dir(root)
        self._path = self.root / "fingerprints.json"
        self._fingerprints: Dict[str, str] = {}
        self._load()

    def _load(self) -> None:
        self._fingerprints.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        fps = raw.get("fingerprints") or {}
        self._fingerprints = {str(k): str(v) for k, v in fps.items()}

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {"fingerprints": dict(sorted(self._fingerprints.items()))}
        self._path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def snapshot(self) -> Dict[str, str]:
        return dict(self._fingerprints)

    def _current_map(self, docs: Iterable[SourceDocument]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for doc in docs:
            if not isinstance(doc, SourceDocument):
                raise TypeError("docs must contain SourceDocument instances")
            if doc.id in out:
                raise ValueError(f"duplicate SourceDocument.id: {doc.id!r}")
            out[doc.id] = doc.content_hash or content_hash(doc.content)
        return out

    def diff(self, docs: Iterable[SourceDocument]) -> ChangeSet:
        return _diff_maps(self._fingerprints, self._current_map(docs))

    def commit(self, docs: Iterable[SourceDocument]) -> ChangeSet:
        current = self._current_map(docs)
        change = _diff_maps(self._fingerprints, current)
        self._fingerprints = current
        self._persist()
        return change
