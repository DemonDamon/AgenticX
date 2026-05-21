"""Process-wide code index manager."""

from __future__ import annotations

import hashlib
import logging
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from agenticx.code_index.backends.base import CodeIndexBackend, CodeSearchHit
from agenticx.code_index.backends.native_backend import NativeCodeIndexBackend
from agenticx.code_index.backends.semble_backend import SembleCodeIndexBackend, format_error_summary
from agenticx.code_index.config import CodeIndexConfig, load_code_index_config
from agenticx.code_index.state import IndexCancelledError, IndexStatus, IndexTask

logger = logging.getLogger(__name__)

_encoder_lock = threading.Lock()
_encoder: Any = None
_encoder_load_count = 0


def _task_key(codebase_path: Path) -> str:
    return hashlib.sha256(str(codebase_path.resolve()).encode()).hexdigest()[:16]


def load_encoder(model_name: str) -> Any:
    global _encoder, _encoder_load_count
    with _encoder_lock:
        if _encoder is None:
            try:
                from semble.index.dense import load_model
            except ImportError as exc:
                raise ImportError(
                    "缺少 semble 包（代码索引后端）。请在运行 agx serve 的同一 Python 环境中执行："
                    " pip install 'semble>=0.1.10,<0.2.0' pathspec"
                    " 或 pip install -e '.[code_index]' / pip install -e '.[desktop-runtime]'"
                ) from exc

            _encoder = load_model(model_name)
            _encoder_load_count += 1
            logger.info("code_index.encoder.loaded model=%s count=%s", model_name, _encoder_load_count)
        return _encoder


def encoder_load_count_for_tests() -> int:
    with _encoder_lock:
        return _encoder_load_count


def reset_encoder_for_tests() -> None:
    global _encoder, _encoder_load_count
    with _encoder_lock:
        _encoder = None
        _encoder_load_count = 0


class CodeIndexManager:
    _instance_lock = threading.RLock()
    _instance: Optional["CodeIndexManager"] = None

    @classmethod
    def instance(cls) -> "CodeIndexManager":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @classmethod
    def reset_for_tests(cls) -> None:
        with cls._instance_lock:
            if cls._instance is not None:
                cls._instance.clear_all()
            cls._instance = None
        reset_encoder_for_tests()

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._tasks: dict[str, IndexTask] = {}
        self._backends: dict[str, CodeIndexBackend] = {}
        self._build_threads: dict[str, threading.Thread] = {}

    def _config(self, override: Optional[CodeIndexConfig] = None) -> CodeIndexConfig:
        return override if override is not None else load_code_index_config()

    def _make_backend(self, cfg: CodeIndexConfig) -> CodeIndexBackend:
        if cfg.backend == "native":
            return NativeCodeIndexBackend()
        encoder = load_encoder(cfg.semble_model)
        return SembleCodeIndexBackend(
            encoder=encoder,
            include_text_files=cfg.semble_include_text_files,
            max_memory_bytes=cfg.max_index_memory_mb * 1024 * 1024,
        )

    def _get_task(self, codebase_path: Path) -> IndexTask:
        key = _task_key(codebase_path)
        with self._lock:
            task = self._tasks.get(key)
            if task is None:
                task = IndexTask(
                    codebase_path=str(codebase_path.resolve()),
                    task_id=key,
                )
                self._tasks[key] = task
            return task

    def preload_model(self) -> None:
        cfg = self._config()
        load_encoder(cfg.semble_model)

    def get_status(self, codebase_path: Path) -> dict[str, Any]:
        task = self._get_task(codebase_path)
        with task.lock:
            return task.to_status_dict()

    def clear(self, codebase_path: Path) -> None:
        key = _task_key(codebase_path)
        with self._lock:
            task = self._tasks.pop(key, None)
            backend = self._backends.pop(key, None)
            thread = self._build_threads.pop(key, None)
        if task is not None:
            task.cancel_event.set()
        if backend is not None:
            backend.clear()
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)

    def clear_all(self) -> None:
        with self._lock:
            keys = list(self._tasks.keys())
        for key in keys:
            path_str = self._tasks.get(key, IndexTask(codebase_path="")).codebase_path
            if path_str:
                self.clear(Path(path_str))

    def cancel(self, task_id: str) -> bool:
        with self._lock:
            for task in self._tasks.values():
                if task.task_id == task_id:
                    task.cancel_event.set()
                    return True
        return False

    def _run_build(
        self,
        codebase_path: Path,
        *,
        wait: bool = False,
        config: Optional[CodeIndexConfig] = None,
    ) -> IndexTask:
        cfg = self._config(config)
        task = self._get_task(codebase_path)
        key = _task_key(codebase_path)

        def _build() -> None:
            started = time.perf_counter()
            with task.lock:
                if task.status == IndexStatus.INDEXED:
                    return
                task.status = IndexStatus.INDEXING
                task.error_summary = None
                task.cancel_event.clear()
            try:
                with self._lock:
                    backend = self._backends.get(key)
                    if backend is None:
                        backend = self._make_backend(cfg)
                        self._backends[key] = backend

                def on_progress(done: int, total: int) -> None:
                    with task.lock:
                        task.touch_progress(done, total)

                backend.build(
                    codebase_path,
                    on_progress=on_progress,
                    cancel_event=task.cancel_event,
                    include_text_files=cfg.semble_include_text_files,
                )
                stats = backend.stats
                with task.lock:
                    task.status = IndexStatus.INDEXED
                    task.total_chunks = int(stats.get("total_chunks", 0))
                    task.languages = dict(stats.get("languages", {}))
                    task.backend_stats = stats
                    task.touch_progress(task.files_total or 1, task.files_total or 1)
                logger.info(
                    "code_index.build.done path=%s seconds=%.2f",
                    codebase_path,
                    time.perf_counter() - started,
                )
            except IndexCancelledError:
                with task.lock:
                    task.status = IndexStatus.PENDING
                    task.error_summary = "索引已取消"
            except Exception as exc:
                summary = format_error_summary(exc)
                with task.lock:
                    task.status = IndexStatus.INDEXFAILED
                    task.error_summary = summary
                logger.exception("code_index.build.fail path=%s", codebase_path)
            finally:
                with self._lock:
                    self._build_threads.pop(key, None)

        with self._lock:
            existing = self._build_threads.get(key)

        with task.lock:
            if task.status == IndexStatus.INDEXED:
                return task

        if wait:
            if existing is not None and existing.is_alive():
                existing.join(timeout=300.0)
                return task
            if task.status == IndexStatus.INDEXING and existing is None:
                return task
            _build()
            return task

        with task.lock:
            if task.status == IndexStatus.INDEXING:
                return task

        with self._lock:
            if existing is not None and existing.is_alive():
                return task
            thread = threading.Thread(target=_build, name=f"code-index-{key}", daemon=True)
            self._build_threads[key] = thread
            thread.start()
        return task

    def ensure_indexing(
        self, codebase_path: Path, *, config: Optional[CodeIndexConfig] = None
    ) -> IndexTask:
        task = self._get_task(codebase_path)
        with task.lock:
            if task.status in (IndexStatus.INDEXED, IndexStatus.INDEXING):
                return task
        return self._run_build(codebase_path, wait=False, config=config)

    def create_index(
        self, codebase_path: Path, *, config: Optional[CodeIndexConfig] = None
    ) -> dict[str, Any]:
        task = self._run_build(codebase_path, wait=False, config=config)
        with task.lock:
            return {"task_id": task.task_id, "status": task.status.value}

    def wait_until_indexed(self, codebase_path: Path, *, timeout: float = 300.0) -> IndexTask:
        task = self._run_build(codebase_path, wait=False)
        deadline = time.time() + timeout
        while time.time() < deadline:
            with task.lock:
                if task.status in (IndexStatus.INDEXED, IndexStatus.INDEXFAILED):
                    return task
            time.sleep(0.1)
        return task

    def search(
        self,
        codebase_path: Path,
        query: str,
        *,
        top_k: int | None = None,
        strategy: str | None = None,
        wait_for_index: bool = True,
        config: Optional[CodeIndexConfig] = None,
    ) -> tuple[list[CodeSearchHit], bool, dict[str, Any] | None]:
        cfg = self._config(config)
        task = self.ensure_indexing(codebase_path, config=config)
        if wait_for_index and task.status == IndexStatus.INDEXING:
            task = self.wait_until_indexed(codebase_path, timeout=300.0)

        with task.lock:
            status = task.status
            progress = {
                "files_done": task.files_done,
                "files_total": task.files_total,
                "status": task.status.value,
            }
            if status == IndexStatus.INDEXFAILED:
                raise RuntimeError(task.error_summary or "索引失败")
            if status != IndexStatus.INDEXED:
                return [], True, progress

        key = _task_key(codebase_path)
        with self._lock:
            backend = self._backends.get(key)
        if backend is None:
            return [], True, progress

        k = top_k if top_k is not None else cfg.semble_default_top_k
        mode = strategy or cfg.semble_search_mode
        hits = list(backend.search(query, top_k=k, strategy=mode))
        return hits, False, None
