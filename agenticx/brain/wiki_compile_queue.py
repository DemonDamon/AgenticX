"""Wiki page writing, off the document ingest thread pool.

Author: Damon Li
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_STAGE_PROGRESS = {
    "queued": 0.0,
    "reading": 0.15,
    "analyzing": 0.4,
    "generating": 0.7,
    "writing": 0.9,
    "done": 1.0,
    "failed": 1.0,
    "cancelled": 1.0,
    "skipped": 1.0,
}


class WikiCompileQueue:
    """One background worker so indexing threads are not stuck inside model calls."""

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="agx-wiki-compile")
        self._lock = threading.Lock()
        self._items: Dict[str, Dict[str, Any]] = {}
        self._cancel_events: Dict[str, threading.Event] = {}
        self._generations: Dict[str, int] = {}

    def list_status(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [dict(item) for item in self._items.values()]

    def note(
        self,
        doc_id: str,
        source_name: str,
        status: str,
        message: str = "",
        *,
        model: str = "",
        stage: str = "",
    ) -> None:
        progress = _STAGE_PROGRESS.get(stage or status, 0.0)
        with self._lock:
            previous = self._items.get(doc_id) or {}
            self._items[doc_id] = {
                "document_id": doc_id,
                "source_name": source_name,
                "status": status,
                "message": message,
                "stage": stage or status,
                "progress": progress,
                "model": model or str(previous.get("model") or ""),
            }

    def enqueue(self, docs_rt: Any, doc_id: str, source_name: str, model_label: str = "") -> None:
        with self._lock:
            generation = self._generations.get(doc_id, 0) + 1
            self._generations[doc_id] = generation
            previous = self._cancel_events.get(doc_id)
            if previous is not None:
                previous.set()
            event = threading.Event()
            self._cancel_events[doc_id] = event
        self.note(doc_id, source_name, "queued", "等待写页面", model=model_label, stage="queued")
        self._executor.submit(self._compile, docs_rt, doc_id, source_name, model_label, generation, event)

    def cancel(self, doc_id: Optional[str] = None) -> List[str]:
        with self._lock:
            ids = [doc_id] if doc_id else list(self._items)
        cancelled: List[str] = []
        for item_id in ids:
            if not item_id:
                continue
            with self._lock:
                item = self._items.get(item_id)
                if item is None or item.get("status") not in {"queued", "running"}:
                    continue
                event = self._cancel_events.get(item_id)
                source_name = str(item.get("source_name") or item_id)
                model = str(item.get("model") or "")
            if event is not None:
                event.set()
            self.note(item_id, source_name, "cancelled", "已取消", model=model, stage="cancelled")
            cancelled.append(item_id)
        return cancelled

    def _compile(
        self,
        docs_rt: Any,
        doc_id: str,
        source_name: str,
        model_label: str,
        generation: int,
        event: threading.Event,
    ) -> None:
        if event.is_set() or self._generations.get(doc_id) != generation:
            self.note(doc_id, source_name, "cancelled", "已取消", model=model_label, stage="cancelled")
            return
        self.note(doc_id, source_name, "running", "正在读取正文", model=model_label, stage="reading")

        def _progress(stage: str, message: str) -> None:
            if event.is_set() or self._generations.get(doc_id) != generation:
                return
            self.note(doc_id, source_name, "running", message, model=model_label, stage=stage)

        try:
            from agenticx.brain.wiki_ops import compile_document_wiki

            result = compile_document_wiki(
                docs_rt,
                doc_id,
                progress_cb=_progress,
                cancel_event=event,
            )
        except Exception as exc:
            logger.exception("wiki compile crashed for %s", doc_id)
            self.note(doc_id, source_name, "failed", str(exc), model=model_label, stage="failed")
            return
        if event.is_set() or result.get("cancelled") or self._generations.get(doc_id) != generation:
            self.note(doc_id, source_name, "cancelled", "已取消", model=model_label, stage="cancelled")
            return
        if result.get("skipped"):
            self.note(doc_id, source_name, "skipped", str(result.get("message") or ""), model=model_label, stage="skipped")
            return
        if result.get("ok"):
            written = result.get("written") or []
            self.note(
                doc_id,
                source_name,
                "done",
                f"写入 {len(written)} 页",
                model=model_label,
                stage="done",
            )
            return
        self.note(
            doc_id,
            source_name,
            "failed",
            str(result.get("error") or "编译失败"),
            model=model_label,
            stage="failed",
        )


def _model_label(docs_rt: Any) -> str:
    cfg = docs_rt.read_config()
    wiki_cfg = getattr(cfg, "wiki_compiler", None)
    provider = str(getattr(wiki_cfg, "provider", "") or "").strip()
    model = str(getattr(wiki_cfg, "model", "") or "").strip()
    if provider and model:
        return f"{provider}/{model}"
    return ""


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
        queue.note(doc_id, source_name, "skipped", "Wiki 编译未打开", stage="skipped")
        return
    queue.enqueue(docs_rt, doc_id, source_name, _model_label(docs_rt))


def enqueue_wiki_backfill(docs_rt: Any, document_ids: Optional[List[str]] = None) -> List[str]:
    """Queue wiki writing for already indexed documents, without re-embedding."""
    from agenticx.studio.kb.contracts import KBDocumentStatus

    cfg = docs_rt.read_config()
    enabled = bool(getattr(getattr(cfg, "wiki_compiler", None), "enabled", False))
    wanted = set(document_ids or [])
    queued: List[str] = []
    queue: WikiCompileQueue = docs_rt.wiki_compiles
    label = _model_label(docs_rt)
    for doc in docs_rt.runtime.list_documents():
        if doc.status != KBDocumentStatus.DONE:
            continue
        if wanted and doc.id not in wanted:
            continue
        if not enabled:
            queue.note(doc.id, doc.source_name, "skipped", "Wiki 编译未打开", stage="skipped")
            continue
        queue.enqueue(docs_rt, doc.id, doc.source_name, label)
        queued.append(doc.id)
    return queued
