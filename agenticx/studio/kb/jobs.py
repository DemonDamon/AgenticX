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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

from .contracts import IngestJob, IngestJobStatus, KBDocumentStatus
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
}

_PROGRESS_WEIGHTS = {
    IngestJobStatus.QUEUED: 0.0,
    IngestJobStatus.PARSING: 0.2,
    IngestJobStatus.CHUNKING: 0.4,
    IngestJobStatus.EMBEDDING: 0.7,
    IngestJobStatus.WRITING: 0.9,
    IngestJobStatus.DONE: 1.0,
    IngestJobStatus.FAILED: 1.0,
}


def _weighted_progress(status: IngestJobStatus, stage_progress: Optional[float] = None) -> float:
    """Map coarse status + optional stage progress to a global 0~1 percentage."""

    start = float(_PROGRESS_WEIGHTS.get(status, 0.0))
    if stage_progress is None or status in {IngestJobStatus.DONE, IngestJobStatus.FAILED}:
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

        job = IngestJob(
            id=f"job_{uuid.uuid4().hex[:12]}",
            document_id=document_id,
            status=IngestJobStatus.QUEUED,
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        with self._lock:
            self._jobs[job.id] = job
        self._executor.submit(self._run, runtime, job, on_done)
        return job

    # ------------------------------ worker ----------------------------- #

    def _run(
        self,
        runtime: KBRuntime,
        job: IngestJob,
        on_done: Optional[Callable[[IngestJob], None]],
    ) -> None:
        def _progress(status, message: str, stage_progress: Optional[float] = None) -> None:
            mapped = _STATUS_MAP.get(status, IngestJobStatus.PARSING)
            self._update(
                job.id,
                status=mapped,
                progress=_weighted_progress(mapped, stage_progress),
                message=message,
            )

        try:
            if not job.document_id:
                raise ValueError("job.document_id is required")
            report = runtime.ingest_document(job.document_id, progress_cb=_progress)
            terminal = IngestJobStatus.DONE if report.failed == 0 else IngestJobStatus.FAILED
            self._update(
                job.id,
                status=terminal,
                progress=1.0,
                report=report,
                finished_at=datetime.now(timezone.utc).isoformat(),
                message="ok" if terminal == IngestJobStatus.DONE else "; ".join(report.reasons) or "failed",
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
                        logger.debug("on_done callback failed: %s", exc)

    def shutdown(self, *, wait: bool = False) -> None:  # pragma: no cover - used at app shutdown
        self._executor.shutdown(wait=wait, cancel_futures=not wait)
