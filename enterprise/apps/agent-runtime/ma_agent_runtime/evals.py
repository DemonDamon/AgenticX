#!/usr/bin/env python3
"""Eval runner and internal routes. Sessions are created with source=eval.

Memory mounts are forced read_only. MA-A10 should not fold its routes into this module.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import json
import logging
import os
import time
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine

from agenticx.managed.errors import MAError
from agenticx.managed.eval_iterate import (
    build_candidate,
    build_iteration_prompt,
    parse_iteration_response,
    select_failures,
)
from agenticx.managed.evaluation import (
    GatewayJudgeProvider,
    ItemOutcome,
    judge_item,
    run_rule_checks,
    score_item,
    summarize,
    validate_rubric,
)
from agenticx.managed.events.store import ThreadFilter
from agenticx.managed.host.config import Principal
from agenticx.managed.host.models import CreateSessionRequest
from agenticx.managed.ids import new_ulid, utc_now_iso
from agenticx.managed.llm import LLMCallContext, LLMFactory
from agenticx.managed.manifest import MODEL_RE, canonical_json
from agenticx.managed.spec import split_model_ref

from ma_agent_runtime.config import Settings
from ma_agent_runtime.tables import ma_eval_candidates, ma_eval_results, ma_eval_runs

logger = logging.getLogger(__name__)

EVAL_RUN_STATUSES = ("queued", "running", "completed", "failed", "cancelled")
EVAL_RESULT_STATUSES = ("passed", "failed", "error")
HEARTBEAT_SECONDS = 15
STALE_SECONDS = 120
CLAIM_INTERVAL_SECONDS = 2.0
POLL_SECONDS = 1.0
MAX_ITEMS_PER_RUN = 500
_TERMINAL_STOPS = {"retries_exhausted", "policy_blocked", "budget_exceeded"}
_RUN_KEYS = {
    "tenant_id",
    "created_by_user_id",
    "agent_id",
    "agent_version",
    "environment_id",
    "dataset",
    "rubric",
    "memory_store_ids",
    "concurrency",
}
_DATASET_KEYS = {"id", "name", "items"}
_ITEM_KEYS = {"id", "position", "query", "expected_answer", "expected_tool_trace"}
_RUBRIC_KEYS = {"id", "name", "version", "content"}
_ITER_KEYS = {"tenant_id", "created_by_user_id", "base_run_id", "optimizer_model"}
_STATUS_KEYS = {"tenant_id", "status", "applied_version", "decided_by_user_id"}
_WIRE_KEYS = (
    "id",
    "tenant_id",
    "kind",
    "status",
    "agent_id",
    "agent_version",
    "environment_id",
    "dataset_id",
    "dataset_name",
    "dataset_hash",
    "rubric_id",
    "rubric_name",
    "rubric_version",
    "rubric_hash",
    "base_run_id",
    "progress",
    "summary",
    "error",
    "created_by",
    "started_at",
    "finished_at",
    "created_at",
)


class CandidateDecided(Exception):
    """The candidate is no longer proposed and the requested status differs."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return utc_now_iso(value)
    return str(value)


def _json(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value


def _int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    return int(value)


def _row(mapping: Mapping[str, Any]) -> dict[str, Any]:
    data = dict(mapping)
    for key in ("config", "progress", "summary", "tool_names", "rule_results", "judge", "usage", "manifest", "diff", "expected_tool_trace"):
        if key in data:
            fallback = [] if key in {"tool_names", "rule_results"} else {}
            data[key] = _json(data[key], fallback)
    for key in (
        "heartbeat_at",
        "started_at",
        "finished_at",
        "created_at",
        "updated_at",
        "decided_at",
    ):
        if key in data:
            data[key] = _iso(data[key])
    return data


def _wire(row: Mapping[str, Any]) -> dict[str, Any]:
    return {key: row.get(key) for key in _WIRE_KEYS}


def _dataset_hash(items: list[dict[str, Any]]) -> str:
    ordered = sorted(items, key=lambda item: (_int(item.get("position")), str(item.get("id") or "")))
    payload = [
        {
            "query": item.get("query"),
            "expected_answer": item.get("expected_answer"),
            "expected_tool_trace": item.get("expected_tool_trace"),
        }
        for item in ordered
    ]
    digest = hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()
    return "sha256:" + digest


def _nonempty(value: Any) -> bool:
    return isinstance(value, str) and value != ""


def _integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _unknown(body: Mapping[str, Any], allowed: set[str]) -> str | None:
    for key in body:
        if key not in allowed:
            return f"unknown field: {key}"
    return None


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def _authorized(header: str | None, token: str) -> bool:
    if not header or not token:
        return False
    if not header.lower().startswith("bearer "):
        return False
    provided = header[7:].strip()
    if len(provided) != len(token):
        return False
    return hmac.compare_digest(provided, token)


def _validate_items(items: Any) -> str | None:
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS_PER_RUN:
        return "items: must contain 1 to 500 items"
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            return f"items[{index}]: must be an object"
        unknown = _unknown(item, _ITEM_KEYS)
        if unknown:
            return unknown
        for key in ("id", "position", "query"):
            if key not in item:
                return f"items[{index}].{key}: is required"
        if not _nonempty(item.get("id")):
            return f"items[{index}].id: is required"
        if not _integer(item.get("position")):
            return f"items[{index}].position: must be an integer"
        if not _nonempty(item.get("query")):
            return f"items[{index}].query: must be a non-empty string"
        answer = item.get("expected_answer")
        if answer is not None and not isinstance(answer, str):
            return f"items[{index}].expected_answer: must be a string or null"
        trace = item.get("expected_tool_trace")
        if trace is not None and (
            not isinstance(trace, list) or any(not isinstance(name, str) for name in trace)
        ):
            return f"items[{index}].expected_tool_trace: must be a list of strings or null"
    return None


def _validate_run_body(body: Any) -> tuple[str | None, dict[str, Any] | None]:
    if not isinstance(body, dict):
        return "body: must be a JSON object", None
    unknown = _unknown(body, _RUN_KEYS)
    if unknown:
        return unknown, None
    for key in _RUN_KEYS:
        if key not in body:
            return f"{key}: is required", None
    if not _nonempty(body["tenant_id"]):
        return "tenant_id: is required", None
    if not _nonempty(body["created_by_user_id"]):
        return "created_by_user_id: is required", None
    if not _nonempty(body["agent_id"]):
        return "agent_id: is required", None
    if not _integer(body["agent_version"]) or body["agent_version"] < 1:
        return "agent_version: must be an integer >= 1", None
    if body["environment_id"] is not None and not _nonempty(body["environment_id"]):
        return "environment_id: must be a string or null", None
    dataset = body["dataset"]
    if not isinstance(dataset, dict):
        return "dataset: must be an object", None
    unknown = _unknown(dataset, _DATASET_KEYS)
    if unknown:
        return unknown, None
    for key in _DATASET_KEYS:
        if key not in dataset:
            return f"dataset.{key}: is required", None
    if not _nonempty(dataset["id"]) or not _nonempty(dataset["name"]):
        return "dataset: id and name are required", None
    item_error = _validate_items(dataset["items"])
    if item_error:
        return item_error, None
    rubric = body["rubric"]
    if not isinstance(rubric, dict):
        return "rubric: must be an object", None
    unknown = _unknown(rubric, _RUBRIC_KEYS)
    if unknown:
        return unknown, None
    for key in _RUBRIC_KEYS:
        if key not in rubric:
            return f"rubric.{key}: is required", None
    if not _nonempty(rubric["id"]) or not _nonempty(rubric["name"]):
        return "rubric: id and name are required", None
    if not _integer(rubric["version"]) or rubric["version"] < 1:
        return "rubric.version: must be an integer >= 1", None
    checked = validate_rubric(rubric["content"])
    if not checked.ok or checked.normalized is None or checked.content_hash is None:
        return checked.errors[0] if checked.errors else "rubric: invalid", None
    stores = body["memory_store_ids"]
    if (
        not isinstance(stores, list)
        or len(stores) > 8
        or any(not _nonempty(item) for item in stores)
    ):
        return "memory_store_ids: must contain at most 8 strings", None
    if not _integer(body["concurrency"]) or not 1 <= body["concurrency"] <= 4:
        return "concurrency: must be an integer between 1 and 4", None
    return None, {
        "tenant_id": body["tenant_id"],
        "created_by": body["created_by_user_id"],
        "agent_id": body["agent_id"],
        "agent_version": body["agent_version"],
        "environment_id": body["environment_id"],
        "dataset": dataset,
        "rubric": {**rubric, "content": checked.normalized},
        "rubric_hash": checked.content_hash,
        "memory_store_ids": list(stores),
        "concurrency": body["concurrency"],
    }


class EvalStore:
    """Sync SQLAlchemy (same sync engine as PgWorkQueue); every method runs via asyncio.to_thread."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def _insert(self) -> Any:
        if self._engine.dialect.name == "postgresql":
            return pg_insert
        return sqlite_insert

    def _load_run(self, conn: Any, run_id: str, tenant_id: str | None = None) -> dict[str, Any] | None:
        stmt = select(ma_eval_runs).where(ma_eval_runs.c.id == run_id)
        if tenant_id is not None:
            stmt = stmt.where(ma_eval_runs.c.tenant_id == tenant_id)
        row = conn.execute(stmt).mappings().first()
        return _row(row) if row is not None else None

    def create_run(self, row: Mapping[str, Any]) -> dict[str, Any]:
        now = _now()
        values = {
            "id": row.get("id") or new_ulid(),
            "tenant_id": row["tenant_id"],
            "kind": row["kind"],
            "status": row.get("status") or "queued",
            "agent_id": row["agent_id"],
            "agent_version": row["agent_version"],
            "environment_id": row.get("environment_id"),
            "dataset_id": row.get("dataset_id"),
            "dataset_name": row["dataset_name"],
            "dataset_hash": row["dataset_hash"],
            "rubric_id": row.get("rubric_id"),
            "rubric_name": row["rubric_name"],
            "rubric_version": row["rubric_version"],
            "rubric_hash": row["rubric_hash"],
            "base_run_id": row.get("base_run_id"),
            "config": row["config"],
            "progress": row.get("progress") or {},
            "summary": row.get("summary") or {},
            "error": row.get("error"),
            "created_by": row.get("created_by"),
            "claimed_by": row.get("claimed_by"),
            "heartbeat_at": row.get("heartbeat_at"),
            "started_at": row.get("started_at"),
            "finished_at": row.get("finished_at"),
            "created_at": row.get("created_at") or now,
            "updated_at": row.get("updated_at") or now,
        }
        with self._engine.begin() as conn:
            conn.execute(ma_eval_runs.insert().values(**values))
            loaded = self._load_run(conn, str(values["id"]))
        if loaded is None:
            raise RuntimeError("eval run insert failed")
        return loaded

    def claim_next(self, worker_id: str) -> dict[str, Any] | None:
        now = _now()
        with self._engine.begin() as conn:
            stmt = (
                select(ma_eval_runs)
                .where(ma_eval_runs.c.status == "queued")
                .order_by(ma_eval_runs.c.created_at, ma_eval_runs.c.id)
                .limit(1)
            )
            if conn.dialect.name == "postgresql":
                stmt = stmt.with_for_update(skip_locked=True)
            selected = conn.execute(stmt).mappings().first()
            if selected is None:
                return None
            run_id = str(selected["id"])
            started = selected["started_at"] or now
            updated = conn.execute(
                update(ma_eval_runs)
                .where(ma_eval_runs.c.id == run_id, ma_eval_runs.c.status == "queued")
                .values(
                    status="running",
                    claimed_by=worker_id,
                    heartbeat_at=now,
                    started_at=started,
                    updated_at=now,
                )
            )
            if updated.rowcount != 1:
                return None
            return self._load_run(conn, run_id)

    def requeue_stale(self) -> int:
        cutoff = _now() - timedelta(seconds=STALE_SECONDS)
        with self._engine.begin() as conn:
            updated = conn.execute(
                update(ma_eval_runs)
                .where(
                    ma_eval_runs.c.status == "running",
                    ma_eval_runs.c.heartbeat_at.is_not(None),
                    ma_eval_runs.c.heartbeat_at < cutoff,
                )
                .values(status="queued", claimed_by=None, updated_at=_now())
            )
        return int(updated.rowcount or 0)

    def heartbeat(self, run_id: str, worker_id: str, progress: Mapping[str, Any]) -> bool:
        with self._engine.begin() as conn:
            updated = conn.execute(
                update(ma_eval_runs)
                .where(
                    ma_eval_runs.c.id == run_id,
                    ma_eval_runs.c.claimed_by == worker_id,
                    ma_eval_runs.c.status == "running",
                )
                .values(heartbeat_at=_now(), progress=dict(progress), updated_at=_now())
            )
        return updated.rowcount == 1

    def finished_item_ids(self, run_id: str) -> set[str]:
        with self._engine.begin() as conn:
            rows = conn.execute(
                select(ma_eval_results.c.item_id).where(ma_eval_results.c.run_id == run_id)
            ).all()
        return {str(row[0]) for row in rows}

    def insert_result(self, row: Mapping[str, Any]) -> None:
        now = _now()
        values = {
            "id": row.get("id") or new_ulid(),
            "tenant_id": row["tenant_id"],
            "run_id": row["run_id"],
            "item_id": row["item_id"],
            "position": row["position"],
            "status": row["status"],
            "score_milli": row.get("score_milli"),
            "session_id": row.get("session_id"),
            "answer": row.get("answer"),
            "tool_names": list(row.get("tool_names") or []),
            "stop_reason": row.get("stop_reason"),
            "rule_results": list(row.get("rule_results") or []),
            "judge": row.get("judge"),
            "usage": dict(row.get("usage") or {}),
            "duration_ms": _int(row.get("duration_ms")),
            "error": row.get("error"),
            "created_at": now,
        }
        stmt = self._insert()(ma_eval_results).values(**values)
        stmt = stmt.on_conflict_do_nothing(index_elements=["run_id", "item_id"])
        with self._engine.begin() as conn:
            conn.execute(stmt)

    def list_results(self, run_id: str) -> list[dict[str, Any]]:
        with self._engine.begin() as conn:
            rows = conn.execute(
                select(ma_eval_results)
                .where(ma_eval_results.c.run_id == run_id)
                .order_by(ma_eval_results.c.position, ma_eval_results.c.id)
            ).mappings()
            return [_row(row) for row in rows]

    def finish_run(
        self,
        run_id: str,
        worker_id: str,
        *,
        status: str,
        summary: Mapping[str, Any],
        error: str | None,
    ) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                update(ma_eval_runs)
                .where(
                    ma_eval_runs.c.id == run_id,
                    ma_eval_runs.c.claimed_by == worker_id,
                    ma_eval_runs.c.status == "running",
                )
                .values(
                    status=status,
                    summary=dict(summary),
                    error=error,
                    finished_at=_now(),
                    updated_at=_now(),
                )
            )

    def request_cancel(self, tenant_id: str, run_id: str) -> dict[str, Any] | None:
        now = _now()
        with self._engine.begin() as conn:
            current = self._load_run(conn, run_id, tenant_id)
            if current is None:
                return None
            if current["status"] in {"queued", "running"}:
                conn.execute(
                    update(ma_eval_runs)
                    .where(
                        ma_eval_runs.c.id == run_id,
                        ma_eval_runs.c.tenant_id == tenant_id,
                        ma_eval_runs.c.status == current["status"],
                    )
                    .values(status="cancelled", finished_at=now, updated_at=now)
                )
                return self._load_run(conn, run_id, tenant_id)
            return current

    def get_run(self, tenant_id: str, run_id: str) -> dict[str, Any] | None:
        with self._engine.begin() as conn:
            return self._load_run(conn, run_id, tenant_id)

    def insert_candidate(self, row: Mapping[str, Any]) -> dict[str, Any]:
        now = _now()
        candidate_id = row.get("id") or new_ulid()
        values = {
            "id": candidate_id,
            "tenant_id": row["tenant_id"],
            "run_id": row["run_id"],
            "base_run_id": row["base_run_id"],
            "agent_id": row["agent_id"],
            "base_version": row["base_version"],
            "manifest": row["manifest"],
            "manifest_hash": row["manifest_hash"],
            "diff": row.get("diff") or {},
            "rationale": row.get("rationale"),
            "status": row.get("status") or "proposed",
            "applied_version": row.get("applied_version"),
            "decided_by": row.get("decided_by"),
            "decided_at": row.get("decided_at"),
            "created_at": now,
            "updated_at": now,
        }
        with self._engine.begin() as conn:
            conn.execute(ma_eval_candidates.insert().values(**values))
            loaded = conn.execute(
                select(ma_eval_candidates).where(ma_eval_candidates.c.id == candidate_id)
            ).mappings().one()
        return _row(loaded)

    def set_candidate_status(
        self,
        tenant_id: str,
        candidate_id: str,
        *,
        status: str,
        applied_version: int | None,
        decided_by: str | None,
    ) -> dict[str, Any] | None:
        now = _now()
        with self._engine.begin() as conn:
            current = conn.execute(
                select(ma_eval_candidates).where(
                    ma_eval_candidates.c.id == candidate_id,
                    ma_eval_candidates.c.tenant_id == tenant_id,
                )
            ).mappings().first()
            if current is None:
                return None
            current_status = str(current["status"])
            if current_status == status:
                return _row(current)
            if current_status != "proposed":
                raise CandidateDecided()
            conn.execute(
                update(ma_eval_candidates)
                .where(ma_eval_candidates.c.id == candidate_id)
                .values(
                    status=status,
                    applied_version=applied_version,
                    decided_by=decided_by,
                    decided_at=now,
                    updated_at=now,
                )
            )
            loaded = conn.execute(
                select(ma_eval_candidates).where(ma_eval_candidates.c.id == candidate_id)
            ).mappings().one()
        return _row(loaded)


def _message_text(payload: Mapping[str, Any]) -> str:
    content = payload.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return "".join(parts)


class EvalRunner:
    def __init__(
        self,
        *,
        state: Any,
        store: EvalStore,
        llm_factory: LLMFactory,
        item_timeout_seconds: float,
        max_concurrent_runs: int,
        worker_id: str,
        claim_interval_seconds: float = CLAIM_INTERVAL_SECONDS,
    ) -> None:
        self._state = state
        self._store = store
        self._llm_factory = llm_factory
        self._item_timeout = item_timeout_seconds
        self._max_concurrent = max_concurrent_runs
        self._worker_id = worker_id
        self._claim_interval = claim_interval_seconds
        self._stopped = False
        self._main: asyncio.Task[None] | None = None
        self._tasks: set[asyncio.Task[None]] = set()
        self._progress: dict[str, dict[str, int]] = {}

    async def start(self) -> None:
        self._stopped = False
        self._main = asyncio.create_task(self._loop(), name="ma-eval-runner")

    async def stop(self) -> None:
        self._stopped = True
        if self._main is not None:
            self._main.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._main
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _loop(self) -> None:
        while not self._stopped:
            try:
                await asyncio.to_thread(self._store.requeue_stale)
                while len(self._tasks) < self._max_concurrent and not self._stopped:
                    run = await asyncio.to_thread(self._store.claim_next, self._worker_id)
                    if run is None:
                        break
                    task = asyncio.create_task(self._dispatch(run), name=f"ma-eval-{run['id']}")
                    self._tasks.add(task)
                    task.add_done_callback(self._tasks.discard)
                await asyncio.sleep(self._claim_interval)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("eval runner loop failed")
                await asyncio.sleep(self._claim_interval)

    async def _dispatch(self, run: dict[str, Any]) -> None:
        heart = asyncio.create_task(self._heart(run["id"]))
        try:
            if run.get("kind") == "iterate":
                await self._run_iterate(run)
            else:
                await self._run_eval(run)
        finally:
            heart.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heart
            self._progress.pop(run["id"], None)

    async def _heart(self, run_id: str) -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            progress = self._progress.get(run_id, {})
            alive = await asyncio.to_thread(self._store.heartbeat, run_id, self._worker_id, progress)
            if not alive:
                return

    async def _owned(self, run: dict[str, Any]) -> bool:
        current = await asyncio.to_thread(self._store.get_run, run["tenant_id"], run["id"])
        return (
            current is not None
            and current.get("status") == "running"
            and current.get("claimed_by") == self._worker_id
        )

    async def _run_eval(self, run: dict[str, Any]) -> None:
        try:
            items = list((run.get("config") or {}).get("dataset", {}).get("items") or [])
            existing = await asyncio.to_thread(self._store.list_results, run["id"])
            done_ids = {str(row["item_id"]) for row in existing}
            counters = {
                "total": len(items),
                "done": len(existing),
                "passed": sum(1 for row in existing if row.get("status") == "passed"),
                "failed": sum(1 for row in existing if row.get("status") == "failed"),
                "errored": sum(1 for row in existing if row.get("status") == "error"),
            }
            self._progress[run["id"]] = counters
            sem = asyncio.Semaphore(int((run.get("config") or {}).get("concurrency") or 1))
            stop = asyncio.Event()

            async def one(item: Mapping[str, Any]) -> None:
                if stop.is_set():
                    return
                async with sem:
                    if stop.is_set() or not await self._owned(run):
                        stop.set()
                        return
                    result = await self._run_item(run, item)
                    await asyncio.to_thread(self._store.insert_result, result)
                    counters["done"] += 1
                    status = str(result.get("status"))
                    if status == "passed":
                        counters["passed"] += 1
                    elif status == "failed":
                        counters["failed"] += 1
                    else:
                        counters["errored"] += 1
                    self._progress[run["id"]] = dict(counters)
                    alive = await asyncio.to_thread(
                        self._store.heartbeat,
                        run["id"],
                        self._worker_id,
                        counters,
                    )
                    if not alive:
                        stop.set()

            await asyncio.gather(*(one(item) for item in items if str(item.get("id")) not in done_ids))
            if stop.is_set() or not await self._owned(run):
                return
            results = await asyncio.to_thread(self._store.list_results, run["id"])
            await asyncio.to_thread(
                self._store.finish_run,
                run["id"],
                self._worker_id,
                status="completed",
                summary=summarize(results),
                error=None,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("eval run failed")
            await asyncio.to_thread(
                self._store.finish_run,
                run["id"],
                self._worker_id,
                status="failed",
                summary={},
                error=type(exc).__name__,
            )

    async def _run_iterate(self, run: dict[str, Any]) -> None:
        try:
            base = await asyncio.to_thread(self._store.get_run, run["tenant_id"], str(run.get("base_run_id") or ""))
            if base is None or base.get("kind") != "eval" or base.get("status") != "completed":
                await self._fail(run, "base run is not a completed eval run")
                return
            version = await self._state.registry.get_version(
                run["tenant_id"],
                base["agent_id"],
                base["agent_version"],
            )
            if version is None:
                await self._fail(run, "agent version not found")
                return
            manifest = version.manifest
            if hasattr(manifest, "model_dump"):
                manifest = manifest.model_dump()
            results = await asyncio.to_thread(self._store.list_results, base["id"])
            items = list((base.get("config") or {}).get("dataset", {}).get("items") or [])
            by_id = {str(item.get("id")): item for item in items}
            failures = []
            for row in select_failures(results):
                source = by_id.get(str(row.get("item_id")), {})
                failures.append({**row, "query": source.get("query") or ""})
            if not failures:
                await self._fail(run, "no failed cases to improve")
                return
            model_ref = str((run.get("config") or {}).get("optimizer_model") or "")
            provider, model = split_model_ref(model_ref)
            llm = self._llm_factory.create(
                provider=provider,
                model=model,
                context=LLMCallContext(
                    tenant_id=run["tenant_id"],
                    session_id=run["id"],
                    agent_id="ma.eval.optimizer",
                    agent_version=1,
                    user_id=run.get("created_by"),
                ),
            )
            content = ((base.get("config") or {}).get("rubric") or {}).get("content") or {}
            prompt = build_iteration_prompt(
                system=str(manifest.get("system") or ""),
                criteria=str(content.get("criteria") or ""),
                failures=failures,
            )
            response = await asyncio.to_thread(llm.invoke, [{"role": "user", "content": prompt}])
            parsed = parse_iteration_response(str(getattr(response, "content", "") or ""))
            if parsed is None:
                await self._fail(run, "optimizer returned invalid JSON")
                return
            system, rationale = parsed
            try:
                candidate = build_candidate(manifest, system)
            except ValueError as exc:
                await self._fail(run, str(exc))
                return
            if not await self._owned(run):
                return
            stored = await asyncio.to_thread(
                self._store.insert_candidate,
                {
                    "tenant_id": run["tenant_id"],
                    "run_id": run["id"],
                    "base_run_id": base["id"],
                    "agent_id": base["agent_id"],
                    "base_version": base["agent_version"],
                    "manifest": candidate["manifest"],
                    "manifest_hash": candidate["manifest_hash"],
                    "diff": candidate["diff"],
                    "rationale": rationale,
                    "status": "proposed",
                },
            )
            await asyncio.to_thread(
                self._store.finish_run,
                run["id"],
                self._worker_id,
                status="completed",
                summary={"candidate_id": stored["id"]},
                error=None,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("eval iteration failed")
            await self._fail(run, type(exc).__name__)

    async def _fail(self, run: dict[str, Any], message: str) -> None:
        await asyncio.to_thread(
            self._store.finish_run,
            run["id"],
            self._worker_id,
            status="failed",
            summary={},
            error=message,
        )

    async def _interrupt(self, principal: Principal, session_id: str) -> None:
        await self._state.service.post_events(
            principal,
            session_id,
            {"events": [{"type": "user.interrupt"}]},
        )

    async def _wait_not_action(self, principal: Principal, session_id: str, seconds: float) -> Any:
        deadline = time.monotonic() + seconds
        record = await self._state.service.get_session(principal, session_id)
        while time.monotonic() < deadline:
            stop = record.stop_reason.type if record.stop_reason is not None else None
            if record.status == "idle" and stop != "requires_action":
                return record
            await asyncio.sleep(0.2)
            record = await self._state.service.get_session(principal, session_id)
        return record

    async def _events_after(self, tenant_id: str, session_id: str, after_seq: int) -> list[Any]:
        events: list[Any] = []
        cursor = after_seq
        while True:
            batch = await self._state.store.list_events(
                tenant_id,
                session_id,
                after_seq=cursor,
                limit=500,
                thread_filter=ThreadFilter("session"),
            )
            if not batch:
                break
            events.extend(batch)
            cursor = batch[-1].seq
            if len(batch) < 500:
                break
        return events

    async def _wait_outcome(self, principal: Principal, session_id: str, after_seq: int) -> ItemOutcome:
        deadline = time.monotonic() + self._item_timeout
        error: str | None = None
        record = await self._state.service.get_session(principal, session_id)
        while True:
            stop = record.stop_reason.type if record.stop_reason is not None else None
            if record.status == "idle" and stop:
                if stop == "requires_action":
                    await self._interrupt(principal, session_id)
                    record = await self._wait_not_action(principal, session_id, 10)
                    error = "requires_action"
                break
            if time.monotonic() >= deadline:
                with contextlib.suppress(Exception):
                    await self._interrupt(principal, session_id)
                error = "timeout"
                record = await self._state.service.get_session(principal, session_id)
                break
            await asyncio.sleep(POLL_SECONDS)
            record = await self._state.service.get_session(principal, session_id)
        stop = record.stop_reason.type if record.stop_reason is not None else None
        events = await self._events_after(principal.tenant_id, session_id, after_seq)
        answer = ""
        names: list[str] = []
        for event in events:
            if event.thread_id is not None:
                continue
            if event.type == "agent.message":
                answer = _message_text(event.payload)
            elif event.type in {"agent.tool_use", "agent.mcp_tool_use", "agent.custom_tool_use"}:
                name = event.payload.get("name") if isinstance(event.payload, Mapping) else None
                if isinstance(name, str):
                    names.append(name)
        if error is None and stop in _TERMINAL_STOPS:
            error = stop
        return ItemOutcome(answer=answer, tool_names=tuple(names), stop_reason=stop, error=error)

    async def _run_item(self, run: dict[str, Any], item: Mapping[str, Any]) -> dict[str, Any]:
        started = time.monotonic()
        principal = Principal(
            tenant_id=str(run["tenant_id"]),
            user_id=str(run.get("created_by") or "system"),
            scopes=frozenset({"ma:admin"}),
        )
        config = run.get("config") or {}
        resources = [
            {"type": "memory_store", "memory_store_id": sid, "access": "read_only"}
            for sid in list(config.get("memory_store_ids") or [])
        ]
        session_id: str | None = None
        error: str | None = None
        answer = ""
        tool_names: list[str] = []
        stop_reason: str | None = None
        rule_results: list[dict[str, Any]] = []
        judge: dict[str, Any] | None = None
        usage: dict[str, Any] = {}
        status = "error"
        score_milli: int | None = None
        try:
            record = await self._state.service.create_session(
                principal,
                CreateSessionRequest(
                    agent_id=str(run["agent_id"]),
                    agent_version=int(run["agent_version"]),
                    environment_id=run.get("environment_id"),
                    resources=resources,
                    title=f"eval {str(run['id'])[-6:]} #{item['position']}",
                    source="eval",
                ),
            )
        except MAError as exc:
            error = f"create_session: {exc.code}"
        else:
            session_id = record.id
            try:
                posted = await self._state.service.post_events(
                    principal,
                    record.id,
                    {"events": [{"type": "user.message", "content": [{"type": "text", "text": item["query"]}]}]},
                )
                after_seq = posted[-1].seq if posted else 0
                outcome = await self._wait_outcome(principal, record.id, after_seq)
                error = outcome.error
                answer = outcome.answer
                tool_names = list(outcome.tool_names)
                stop_reason = outcome.stop_reason
                fresh = await self._state.service.get_session(principal, record.id)
                dumped = fresh.usage.model_dump() if hasattr(fresh.usage, "model_dump") else {}
                usage = dict(dumped) if isinstance(dumped, dict) else {}
                if error is None:
                    content = ((config.get("rubric") or {}).get("content") or {})
                    rules = run_rule_checks(
                        list(content.get("rule_checks") or []),
                        outcome,
                        item.get("expected_tool_trace"),
                    )
                    if content.get("judge_model"):
                        provider, model = split_model_ref(str(content["judge_model"]))
                        llm = self._llm_factory.create(
                            provider=provider,
                            model=model,
                            context=LLMCallContext(
                                tenant_id=str(run["tenant_id"]),
                                session_id=record.id,
                                agent_id="ma.eval.judge",
                                agent_version=1,
                                user_id=run.get("created_by"),
                            ),
                        )
                        judge = await judge_item(
                            content,
                            query=str(item["query"]),
                            answer=answer,
                            expected_answer=item.get("expected_answer"),
                            provider=GatewayJudgeProvider(llm),
                        )
                    status, score = score_item(content, rules, judge)
                    score_milli = round(score * 1000)
                    rule_results = [
                        {"type": rule.type, "passed": rule.passed, "detail": rule.detail} for rule in rules
                    ]
            except Exception as exc:
                logger.exception("eval item failed")
                error = type(exc).__name__
                status = "error"
                score_milli = None
            try:
                await self._state.service.archive(principal, record.id)
            except Exception:
                logger.warning("eval archive failed for %s", record.id, exc_info=True)
        return {
            "id": new_ulid(),
            "tenant_id": run["tenant_id"],
            "run_id": run["id"],
            "item_id": item["id"],
            "position": int(item["position"]),
            "status": status,
            "score_milli": score_milli,
            "session_id": session_id,
            "answer": answer,
            "tool_names": tool_names,
            "stop_reason": stop_reason,
            "rule_results": rule_results,
            "judge": judge,
            "usage": usage,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "error": error,
        }


def build_internal_router(*, store: EvalStore, internal_token: str) -> APIRouter:
    """Bearer routes under /internal/ma. They are not mounted on /ma/v1."""
    router = APIRouter(prefix="/internal/ma")

    def unauthorized() -> JSONResponse:
        return _error(401, "unauthorized", "invalid internal token")

    @router.post("/eval-runs")
    async def create_eval_run(request: Request) -> JSONResponse:
        if not _authorized(request.headers.get("authorization"), internal_token):
            return unauthorized()
        try:
            body = await request.json()
        except Exception:
            return _error(400, "invalid_request", "body: must be a JSON object")
        message, parsed = _validate_run_body(body)
        if message or parsed is None:
            return _error(400, "invalid_request", message or "invalid request")
        dataset = parsed["dataset"]
        rubric = parsed["rubric"]
        row = await asyncio.to_thread(
            store.create_run,
            {
                "tenant_id": parsed["tenant_id"],
                "kind": "eval",
                "status": "queued",
                "agent_id": parsed["agent_id"],
                "agent_version": parsed["agent_version"],
                "environment_id": parsed["environment_id"],
                "dataset_id": dataset["id"],
                "dataset_name": dataset["name"],
                "dataset_hash": _dataset_hash(list(dataset["items"])),
                "rubric_id": rubric["id"],
                "rubric_name": rubric["name"],
                "rubric_version": rubric["version"],
                "rubric_hash": parsed["rubric_hash"],
                "config": {
                    "dataset": dataset,
                    "rubric": rubric,
                    "memory_store_ids": parsed["memory_store_ids"],
                    "concurrency": parsed["concurrency"],
                },
                "created_by": parsed["created_by"],
            },
        )
        return JSONResponse(status_code=201, content={"run": _wire(row)})

    @router.get("/eval-runs/{run_id}")
    async def get_eval_run(run_id: str, request: Request) -> JSONResponse:
        if not _authorized(request.headers.get("authorization"), internal_token):
            return unauthorized()
        tenant_id = request.query_params.get("tenant_id") or ""
        if not tenant_id:
            return _error(400, "invalid_request", "tenant_id: is required")
        row = await asyncio.to_thread(store.get_run, tenant_id, run_id)
        if row is None:
            return _error(404, "eval_run_not_found", "eval run not found")
        return JSONResponse({"run": _wire(row)})

    @router.post("/eval-runs/{run_id}/cancel")
    async def cancel_eval_run(run_id: str, request: Request) -> JSONResponse:
        if not _authorized(request.headers.get("authorization"), internal_token):
            return unauthorized()
        try:
            body = await request.json()
        except Exception:
            return _error(400, "invalid_request", "body: must be a JSON object")
        if not isinstance(body, dict):
            return _error(400, "invalid_request", "body: must be a JSON object")
        unknown = _unknown(body, {"tenant_id"})
        if unknown:
            return _error(400, "invalid_request", unknown)
        tenant_id = body.get("tenant_id")
        if not _nonempty(tenant_id):
            return _error(400, "invalid_request", "tenant_id: is required")
        row = await asyncio.to_thread(store.request_cancel, str(tenant_id), run_id)
        if row is None:
            return _error(404, "eval_run_not_found", "eval run not found")
        return JSONResponse({"run": _wire(row)})

    @router.post("/eval-iterations")
    async def create_iteration(request: Request) -> JSONResponse:
        if not _authorized(request.headers.get("authorization"), internal_token):
            return unauthorized()
        try:
            body = await request.json()
        except Exception:
            return _error(400, "invalid_request", "body: must be a JSON object")
        if not isinstance(body, dict):
            return _error(400, "invalid_request", "body: must be a JSON object")
        unknown = _unknown(body, _ITER_KEYS)
        if unknown:
            return _error(400, "invalid_request", unknown)
        for key in _ITER_KEYS:
            if key not in body:
                return _error(400, "invalid_request", f"{key}: is required")
        if not _nonempty(body["tenant_id"]) or not _nonempty(body["base_run_id"]):
            return _error(400, "invalid_request", "tenant_id: is required")
        if not _nonempty(body["created_by_user_id"]):
            return _error(400, "invalid_request", "created_by_user_id: is required")
        model = body["optimizer_model"]
        if not isinstance(model, str) or MODEL_RE.fullmatch(model) is None:
            return _error(400, "invalid_request", 'optimizer_model: must be "<providerId>/<modelName>"')
        base = await asyncio.to_thread(store.get_run, body["tenant_id"], body["base_run_id"])
        if base is None:
            return _error(404, "eval_run_not_found", "eval run not found")
        row = await asyncio.to_thread(
            store.create_run,
            {
                "tenant_id": body["tenant_id"],
                "kind": "iterate",
                "status": "queued",
                "agent_id": base["agent_id"],
                "agent_version": base["agent_version"],
                "environment_id": base.get("environment_id"),
                "dataset_id": base.get("dataset_id"),
                "dataset_name": base["dataset_name"],
                "dataset_hash": base["dataset_hash"],
                "rubric_id": base.get("rubric_id"),
                "rubric_name": base["rubric_name"],
                "rubric_version": base["rubric_version"],
                "rubric_hash": base["rubric_hash"],
                "base_run_id": base["id"],
                "config": {"optimizer_model": model},
                "created_by": body["created_by_user_id"],
            },
        )
        return JSONResponse(status_code=201, content={"run": _wire(row)})

    @router.post("/eval-candidates/{candidate_id}/status")
    async def set_status(candidate_id: str, request: Request) -> JSONResponse:
        if not _authorized(request.headers.get("authorization"), internal_token):
            return unauthorized()
        try:
            body = await request.json()
        except Exception:
            return _error(400, "invalid_request", "body: must be a JSON object")
        if not isinstance(body, dict):
            return _error(400, "invalid_request", "body: must be a JSON object")
        unknown = _unknown(body, _STATUS_KEYS)
        if unknown:
            return _error(400, "invalid_request", unknown)
        for key in ("tenant_id", "status", "applied_version", "decided_by_user_id"):
            if key not in body:
                return _error(400, "invalid_request", f"{key}: is required")
        if body["status"] not in {"applied", "discarded"}:
            return _error(400, "invalid_request", "status: must be applied or discarded")
        applied = body["applied_version"]
        if applied is not None and (not _integer(applied) or applied < 1):
            return _error(400, "invalid_request", "applied_version: must be an integer or null")
        if not _nonempty(body["tenant_id"]) or not _nonempty(body["decided_by_user_id"]):
            return _error(400, "invalid_request", "tenant_id: is required")
        try:
            row = await asyncio.to_thread(
                store.set_candidate_status,
                body["tenant_id"],
                candidate_id,
                status=body["status"],
                applied_version=applied,
                decided_by=body["decided_by_user_id"],
            )
        except CandidateDecided:
            return _error(409, "eval_candidate_decided", "eval candidate already decided")
        if row is None:
            return _error(404, "eval_candidate_not_found", "eval candidate not found")
        return JSONResponse({"candidate": row})

    return router


def wire_evals(
    app: FastAPI,
    *,
    sync_engine: Engine,
    llm_factory: LLMFactory,
    settings: Settings,
) -> None:
    """Mount the internal router and start the runner with the host."""
    store = EvalStore(sync_engine)
    runner = EvalRunner(
        state=app.state.ma,
        store=store,
        llm_factory=llm_factory,
        item_timeout_seconds=settings.eval_item_timeout_seconds,
        max_concurrent_runs=settings.eval_max_concurrent_runs,
        worker_id=f"eval-{os.getpid()}"[:64],
        claim_interval_seconds=float(
            getattr(settings, "eval_claim_interval_seconds", CLAIM_INTERVAL_SECONDS)
        ),
    )
    app.include_router(build_internal_router(store=store, internal_token=settings.internal_token))
    app.state.ma.startup_hooks.append(runner.start)
    app.state.ma.shutdown_hooks.append(runner.stop)
    app.state.ma.extras["eval_runner"] = runner
    app.state.ma.extras["eval_store"] = store


__all__ = [
    "CLAIM_INTERVAL_SECONDS",
    "EVAL_RESULT_STATUSES",
    "EVAL_RUN_STATUSES",
    "HEARTBEAT_SECONDS",
    "MAX_ITEMS_PER_RUN",
    "STALE_SECONDS",
    "EvalRunner",
    "EvalStore",
    "build_internal_router",
    "wire_evals",
]
