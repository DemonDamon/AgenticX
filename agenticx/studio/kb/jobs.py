"""Background ingest jobs for the Machi KB MVP.

Plan-Id: machi-kb-stage1-local-mvp
Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md

Uses a bounded thread pool — not asyncio tasks — because the underlying
chromadb / litellm libraries are sync, and blocking the event loop with
file parsing & embedding HTTP calls would stall unrelated routes.
"""

from __future__ import annotations

import logging
import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

from .contracts import IngestJob, IngestJobStatus, IngestReport, KBDocumentStatus
from .runtime import KBRuntime

logger = logging.getLogger(__name__)


_STATUS_MAP = {
    KBDocumentStatus.QUEUED: IngestJobStatus.QUEUED,
    KBDocumentStatus.PARSING: IngestJobStatus.PARSING,
    KBDocumentStatus.CHUNKING: IngestJobStatus.CHUNKING,
    KBDocumentStatus.EMBEDDING: IngestJobStatus.EMBEDDING,
    KBDocumentStatus.WRITING: IngestJobStatus.WRITING,
    KBDocumentStatus.DONE: IngestJobStatus.DONE,
    KBDocumentStatus.FAILED: IngestJobStatus.FAILED,
    KBDocumentStatus.CANCELLED: IngestJobStatus.CANCELLED,
}

_PROGRESS_WEIGHTS = {
    IngestJobStatus.QUEUED: 0.0,
    IngestJobStatus.PARSING: 0.2,
    IngestJobStatus.CHUNKING: 0.4,
    IngestJobStatus.EMBEDDING: 0.7,
    IngestJobStatus.WRITING: 0.9,
    IngestJobStatus.DONE: 1.0,
    IngestJobStatus.FAILED: 1.0,
    IngestJobStatus.CANCELLED: 1.0,
}


def _weighted_progress(status: IngestJobStatus, stage_progress: Optional[float] = None) -> float:
    """Map coarse status + optional stage progress to a global 0~1 percentage."""

    start = float(_PROGRESS_WEIGHTS.get(status, 0.0))
    if stage_progress is None or status in {
        IngestJobStatus.DONE,
        IngestJobStatus.FAILED,
        IngestJobStatus.CANCELLED,
    }:
        return start
    stage_ratio = max(0.0, min(1.0, float(stage_progress)))
    next_weight = 1.0
    for candidate in (
        IngestJobStatus.PARSING,
        IngestJobStatus.CHUNKING,
        IngestJobStatus.EMBEDDING,
        IngestJobStatus.WRITING,
        IngestJobStatus.DONE,
    ):
        value = float(_PROGRESS_WEIGHTS.get(candidate, 1.0))
        if value > start:
            next_weight = value
            break
    return start + (next_weight - start) * stage_ratio


class JobRegistry:
    """In-memory job registry with bounded worker pool.

    Kept simple on purpose: the MVP UI polls ``GET /api/kb/jobs/{id}`` rather
    than subscribing to a stream. A future iteration may wrap this in an
    event bus.
    """

    def __init__(self, *, max_workers: int = 2) -> None:
        self._executor = ThreadPoolExecutor(
            max_workers=max(1, int(max_workers)),
            thread_name_prefix="agx-kb-ingest",
        )
        self._lock = threading.RLock()
        self._jobs: Dict[str, IngestJob] = {}
        self._generations: Dict[str, int] = {}
        self._cancel_events: Dict[str, threading.Event] = {}
        self._futures: Dict[str, Future] = {}

    # ------------------------------ crud ------------------------------- #

    def get(self, job_id: str) -> Optional[IngestJob]:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> List[IngestJob]:
        with self._lock:
            return sorted(self._jobs.values(), key=lambda j: (j.started_at or ""), reverse=True)

    def _update(self, job_id: str, **updates) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            incoming_generation = updates.pop("generation", None)
            if incoming_generation is not None and int(incoming_generation) < int(job.generation):
                return
            new_status = updates.get("status")
            if new_status == IngestJobStatus.DONE and job.status in {
                IngestJobStatus.CANCELLED,
                IngestJobStatus.FAILED,
            }:
                return
            for key, value in updates.items():
                setattr(job, key, value)

    # ------------------------------ submit ----------------------------- #

    def submit_ingest(
        self,
        runtime: KBRuntime,
        document_id: str,
        *,
        on_done: Optional[Callable[[IngestJob], None]] = None,
    ) -> IngestJob:
        """Queue a document for background ingestion. Returns the new job."""

        with self._lock:
            generation = self._generations.get(document_id, 0) + 1
            self._generations[document_id] = generation
        job = IngestJob(
            id=f"job_{uuid.uuid4().hex[:12]}",
            document_id=document_id,
            status=IngestJobStatus.QUEUED,
            started_at=datetime.now(timezone.utc).isoformat(),
            generation=generation,
        )
        event = threading.Event()
        with self._lock:
            self._jobs[job.id] = job
            self._cancel_events[job.id] = event
        fut = self._executor.submit(self._run, runtime, job, on_done, event)
        with self._lock:
            self._futures[job.id] = fut
        return job

    def request_cancel(self, job_id: str, runtime: KBRuntime) -> tuple[IngestJob, bool]:
        """Request cancellation of a queued or running ingest job."""

        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            if job.status in {
                IngestJobStatus.DONE,
                IngestJobStatus.FAILED,
                IngestJobStatus.CANCELLED,
            }:
                return job, True

            event = self._cancel_events.get(job_id)
            if event is None:
                event = threading.Event()
                self._cancel_events[job_id] = event
            event.set()

            fut = self._futures.get(job_id)
            doc_id = job.document_id

        cancelled_before_start = False
        if fut is not None and fut.cancel():
            cancelled_before_start = True
            finished_at = datetime.now(timezone.utc).isoformat()
            with self._lock:
                current = self._jobs.get(job_id)
                if current is not None:
                    current.status = IngestJobStatus.CANCELLED
                    current.progress = 1.0
                    current.finished_at = finished_at
                    current.message = "已取消"
                    current.report = IngestReport(cancelled=1)
                    doc_id = current.document_id

        if cancelled_before_start and doc_id:
            runtime.mark_document_cancelled(doc_id)

        with self._lock:
            latest = self._jobs[job_id]
        return latest, False

    # ------------------------------ worker ----------------------------- #

    def _run(
        self,
        runtime: KBRuntime,
        job: IngestJob,
        on_done: Optional[Callable[[IngestJob], None]],
        cancel_event: threading.Event,
    ) -> None:
        def _progress(status, message: str, stage_progress: Optional[float] = None) -> None:
            mapped = _STATUS_MAP.get(status, IngestJobStatus.PARSING)
            self._update(
                job.id,
                status=mapped,
                progress=_weighted_progress(mapped, stage_progress),
                message=message,
                generation=job.generation,
            )

        try:
            if not job.document_id:
                raise ValueError("job.document_id is required")
            report = runtime.ingest_document(
                job.document_id,
                progress_cb=_progress,
                cancel_event=cancel_event,
            )
            if report.cancelled:
                terminal = IngestJobStatus.CANCELLED
            elif report.failed == 0:
                terminal = IngestJobStatus.DONE
            else:
                terminal = IngestJobStatus.FAILED
            message = (
                "cancelled"
                if terminal == IngestJobStatus.CANCELLED
                else (
                    "ok"
                    if terminal == IngestJobStatus.DONE
                    else "; ".join(report.reasons) or "failed"
                )
            )
            self._update(
                job.id,
                status=terminal,
                progress=1.0,
                report=report,
                finished_at=datetime.now(timezone.utc).isoformat(),
                message=message,
                generation=job.generation,
            )
        except Exception as exc:
            logger.exception("ingest job %s crashed", job.id)
            with self._lock:
                j = self._jobs.get(job.id)
                if j is not None:
                    j.status = IngestJobStatus.FAILED
                    j.progress = 1.0
                    j.message = str(exc)
                    j.finished_at = datetime.now(timezone.utc).isoformat()
                    j.report.failed += 1
                    j.report.reasons.append(str(exc))
        finally:
            if on_done:
                with self._lock:
                    final = self._jobs.get(job.id)
                if final is not None:
                    try:
                        on_done(final)
                    except Exception as exc:  # pragma: no cover - defensive
                        logger.warning("on_done callback failed: %s", exc)

    def shutdown(self, *, wait: bool = False) -> None:  # pragma: no cover - used at app shutdown
        self._executor.shutdown(wait=wait, cancel_futures=not wait)
