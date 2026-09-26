"""Wiki page writing, off the document ingest thread pool.

Author: Damon Li
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class WikiCompileQueue:
    """One background worker so indexing threads are not stuck inside model calls."""

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="agx-wiki-compile")
        self._lock = threading.Lock()
        self._items: Dict[str, Dict[str, str]] = {}

    def list_status(self) -> List[Dict[str, str]]:
        with self._lock:
            return [dict(item) for item in self._items.values()]

    def note(self, doc_id: str, source_name: str, status: str, message: str = "") -> None:
        with self._lock:
            self._items[doc_id] = {
                "document_id": doc_id,
                "source_name": source_name,
                "status": status,
                "message": message,
            }

    def enqueue(self, docs_rt: Any, doc_id: str, source_name: str) -> None:
        self.note(doc_id, source_name, "queued", "")
        self._executor.submit(self._compile, docs_rt, doc_id, source_name)

    def _compile(self, docs_rt: Any, doc_id: str, source_name: str) -> None:
        self.note(doc_id, source_name, "running", "")
        try:
            from agenticx.brain.wiki_ops import compile_document_wiki

            result = compile_document_wiki(docs_rt, doc_id)
        except Exception as exc:
            logger.exception("wiki compile crashed for %s", doc_id)
            self.note(doc_id, source_name, "failed", str(exc))
            return
        if result.get("skipped"):
            self.note(doc_id, source_name, "skipped", str(result.get("message") or ""))
            return
        if result.get("ok"):
            written = result.get("written") or []
            self.note(doc_id, source_name, "done", f"写入 {len(written)} 页")
            return
        self.note(doc_id, source_name, "failed", str(result.get("error") or "编译失败"))


def schedule_wiki_after_ingest(docs_rt: Any, job: Any) -> None:
    """Return immediately. Page writing runs on WikiCompileQueue."""
    from agenticx.studio.kb.contracts import IngestJobStatus

    if getattr(job, "status", None) != IngestJobStatus.DONE:
        return
    doc_id = getattr(job, "document_id", None)
    if not doc_id:
        return
    doc = docs_rt.runtime.get_document(doc_id)
    if doc is None:
        return
    source_name = str(getattr(doc, "source_name", "") or doc_id)
    cfg = docs_rt.read_config()
    enabled = bool(getattr(getattr(cfg, "wiki_compiler", None), "enabled", False))
    queue: WikiCompileQueue = docs_rt.wiki_compiles
    if not enabled:
        queue.note(doc_id, source_name, "skipped", "Wiki 编译未打开")
        return
    queue.enqueue(docs_rt, doc_id, source_name)


def enqueue_wiki_backfill(docs_rt: Any, document_ids: Optional[List[str]] = None) -> List[str]:
    """Queue wiki writing for already indexed documents, without re-embedding."""
    from agenticx.studio.kb.contracts import KBDocumentStatus

    cfg = docs_rt.read_config()
    enabled = bool(getattr(getattr(cfg, "wiki_compiler", None), "enabled", False))
    wanted = set(document_ids or [])
    queued: List[str] = []
    queue: WikiCompileQueue = docs_rt.wiki_compiles
    for doc in docs_rt.runtime.list_documents():
        if doc.status != KBDocumentStatus.DONE:
            continue
        if wanted and doc.id not in wanted:
            continue
        if not enabled:
            queue.note(doc.id, doc.source_name, "skipped", "Wiki 编译未打开")
            continue
        queue.enqueue(docs_rt, doc.id, doc.source_name)
        queued.append(doc.id)
    return queued
