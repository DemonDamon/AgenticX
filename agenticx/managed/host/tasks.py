#!/usr/bin/env python3
"""In-process background bash tasks for one managed cloud session.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from agenticx.cli.agent_tools import _bash_exec_prepare  # reuse sandbox + confirm semantics of bash_exec
from agenticx.managed.events.store import StoredEvent
from agenticx.managed.host.continuation import TurnContinuation, WakeUp
from agenticx.managed.host.platform_tools import PlatformToolResolver
from agenticx.managed.ids import new_ulid, utc_now_iso

logger = logging.getLogger(__name__)

TASK_TOOL_NAMES: tuple[str, ...] = ("task_list", "task_get", "task_kill")
TASK_EVENT_TYPES: tuple[str, ...] = ("session.task_created", "session.task_completed")
TASK_LOG_DIR = ".ma/tasks"
OUTPUT_TAIL_BYTES = 65536
EVENT_OUTPUT_CHARS = 8000
SUMMARY_CHARS = 200
KILL_GRACE_SECONDS = 5.0
_PARTIAL_OUTPUT_CHARS = 2000
_DEFAULT_GET_CHARS = 4000

TaskState = Literal["running", "succeeded", "failed", "cancelled", "unknown"]

TASK_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "task_list",
            "description": (
                "List background tasks of this session "
                "(bash commands that were moved to the background)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "state": {
                        "type": "string",
                        "enum": ["running", "all"],
                        "description": "Default all.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "task_get",
            "description": "Get one background task with its latest output tail.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "max_output_chars": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 16000,
                        "description": "Default 4000.",
                    },
                },
                "required": ["task_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "task_kill",
            "description": "Stop a running background task.",
            "parameters": {
                "type": "object",
                "properties": {"task_id": {"type": "string"}},
                "required": ["task_id"],
            },
        },
    },
]


def _trim_bytes(text: str, limit: int) -> str:
    raw = text.encode("utf-8")
    if len(raw) <= limit:
        return text
    return raw[-limit:].decode("utf-8", errors="ignore")


def format_bash_result(returncode: int | None, stdout: str, stderr: str) -> str:
    """Same text shape as the personal-mode bash_exec result, without the HINT block."""
    return (
        f"exit_code={returncode}\n"
        f"stdout:\n{stdout.strip() or '(empty)'}\n"
        f"stderr:\n{stderr.strip() or '(empty)'}"
    )


def task_created_event(
    *,
    task_id: str,
    tool_name: str,
    tool_use_id: str | None,
    summary: str,
    log_path: str | None,
) -> dict[str, Any]:
    """Build a ``session.task_created`` payload with a fresh id."""
    tool: dict[str, Any] = {"name": tool_name}
    if tool_use_id is not None:
        tool["tool_use_id"] = tool_use_id
    event: dict[str, Any] = {
        "id": new_ulid(),
        "type": "session.task_created",
        "task_id": task_id,
        "tool": tool,
        "summary": summary,
    }
    if log_path is not None:
        event["log_path"] = log_path
    return event


def task_completed_event(
    task_id: str,
    *,
    state: str,
    summary: str = "",
    result: dict[str, Any] | None,
    error: dict[str, str] | None,
    duration_ms: int,
) -> dict[str, Any]:
    """Build a ``session.task_completed`` payload with a fresh id."""
    event: dict[str, Any] = {
        "id": new_ulid(),
        "type": "session.task_completed",
        "task_id": task_id,
        "state": state,
        "summary": summary,
        "duration_ms": max(0, int(duration_ms)),
    }
    if result is not None:
        event["result"] = result
    if error is not None:
        event["error"] = error
    return event


@dataclass
class TaskRecord:
    task_id: str
    session_id: str
    tool_name: str
    tool_use_id: str | None
    summary: str
    state: TaskState
    created_at: str
    finished_at: str | None = None
    log_path: str | None = None
    exit_code: int | None = None
    output: str = ""
    error: dict[str, str] | None = None
    duration_ms: int = 0
    result_body: dict[str, Any] | None = None

    def to_wire(self, *, include_output: bool) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "session_id": self.session_id,
            "thread_id": None,
            "tool": {"name": self.tool_name, "tool_use_id": self.tool_use_id},
            "state": self.state,
            "summary": self.summary,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
            "log_path": self.log_path,
            "duration_ms": self.duration_ms,
            "result": self._wire_result(include_output=include_output),
            "error": self.error,
        }

    def _wire_result(self, *, include_output: bool) -> dict[str, Any] | None:
        if self.state == "running":
            if not include_output:
                return None
            return {"status": "ok", "exit_code": None, "output": self.output}
        body = self.result_body
        if include_output:
            if not isinstance(body, dict):
                return {"status": "error", "exit_code": None, "output": ""}
            return {
                "status": body.get("status", "error"),
                "exit_code": body.get("exit_code"),
                "output": body.get("output", "") if isinstance(body.get("output"), str) else "",
            }
        if not isinstance(body, dict):
            return None
        slim: dict[str, Any] = {"status": body.get("status", "error")}
        if "exit_code" in body:
            slim["exit_code"] = body.get("exit_code")
        return slim


def fold_task_events(rows: Sequence[StoredEvent]) -> dict[str, TaskRecord]:
    """Build records from seq-ordered task events. created without completed -> unknown."""
    records: dict[str, TaskRecord] = {}
    for row in rows:
        if row.type not in TASK_EVENT_TYPES:
            continue
        payload = row.payload
        task_id = payload.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            continue
        if row.type == "session.task_created":
            tool = payload.get("tool") if isinstance(payload.get("tool"), dict) else {}
            name = tool.get("name") if isinstance(tool, dict) else ""
            use_id = tool.get("tool_use_id") if isinstance(tool, dict) else None
            records[task_id] = TaskRecord(
                task_id=task_id,
                session_id=row.session_id,
                tool_name=name if isinstance(name, str) else "",
                tool_use_id=use_id if isinstance(use_id, str) else None,
                summary=payload.get("summary") if isinstance(payload.get("summary"), str) else "",
                state="unknown",
                created_at=row.created_at,
                log_path=payload.get("log_path") if isinstance(payload.get("log_path"), str) else None,
            )
            continue
        record = records.get(task_id)
        if record is None:
            record = TaskRecord(
                task_id=task_id,
                session_id=row.session_id,
                tool_name="",
                tool_use_id=None,
                summary="",
                state="unknown",
                created_at=row.created_at,
            )
            records[task_id] = record
        state = payload.get("state")
        if state in {"succeeded", "failed", "cancelled"}:
            record.state = state
        summary = payload.get("summary")
        if isinstance(summary, str) and summary:
            record.summary = summary
        record.finished_at = row.created_at
        error = payload.get("error")
        if isinstance(error, dict):
            err_type = error.get("type")
            err_message = error.get("message")
            if isinstance(err_type, str) and isinstance(err_message, str):
                record.error = {"type": err_type, "message": err_message}
        else:
            record.error = None
        duration = payload.get("duration_ms")
        if isinstance(duration, int) and not isinstance(duration, bool) and duration >= 0:
            record.duration_ms = duration
        result = payload.get("result")
        if isinstance(result, dict):
            record.result_body = dict(result)
            exit_code = result.get("exit_code")
            record.exit_code = exit_code if isinstance(exit_code, int) and not isinstance(exit_code, bool) else None
            output = result.get("output")
            record.output = output if isinstance(output, str) else ""
        else:
            record.result_body = None
            record.output = ""
            record.exit_code = None
    return records


def overlay_live_records(folded: dict[str, TaskRecord], live: Sequence[TaskRecord]) -> None:
    """Running in-process records replace folded state and output."""
    for item in live:
        if item.state != "running":
            if item.task_id not in folded:
                folded[item.task_id] = item
            continue
        current = folded.get(item.task_id)
        if current is None:
            folded[item.task_id] = item
            continue
        current.state = "running"
        current.output = item.output


class _OutputBuffer:
    """Stdout/stderr capture. The log file is attached only after backgrounding."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.stdout_parts: list[str] = []
        self.stderr_parts: list[str] = []
        self.plain = ""
        self._labeled = ""
        self._handle: Any = None

    async def add(self, label: str, text: str) -> None:
        async with self._lock:
            if label == "stdout":
                self.stdout_parts.append(text)
            else:
                self.stderr_parts.append(text)
            self.plain = _trim_bytes(self.plain + text, OUTPUT_TAIL_BYTES)
            labeled = f"{label}: {text}"
            self._labeled = _trim_bytes(self._labeled + labeled, OUTPUT_TAIL_BYTES)
            handle = self._handle
            if handle is not None:
                handle.write(labeled)
                handle.flush()

    async def attach_log(self, path: Path) -> None:
        async with self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            handle = path.open("a", encoding="utf-8")
            if self._labeled:
                handle.write(self._labeled)
                handle.flush()
            self._handle = handle

    async def close(self) -> None:
        async with self._lock:
            handle = self._handle
            self._handle = None
            if handle is not None:
                handle.close()

    def stdout_text(self) -> str:
        return "".join(self.stdout_parts)

    def stderr_text(self) -> str:
        return "".join(self.stderr_parts)

    def partial_output(self) -> str:
        text = self.plain[-_PARTIAL_OUTPUT_CHARS:]
        if not text.strip():
            return "(empty)"
        return text

    def event_output(self) -> str:
        return self.plain[-EVENT_OUTPUT_CHARS:]


@dataclass
class _Proc:
    process: asyncio.subprocess.Process
    buffer: _OutputBuffer
    readers: list[asyncio.Task[None]]
    exit_task: asyncio.Task[int]
    started: float
    hard: float
    command: str
    cancelled: bool = False
    relative_log: str | None = None
    workdir: Path | None = None
    watch_task: asyncio.Task[None] | None = None
    settled: bool = field(default=False)


def _hard_timeout(explicit: Any, max_runtime_seconds: float) -> float:
    if explicit is None:
        return max_runtime_seconds
    if isinstance(explicit, str) and not explicit.strip():
        return max_runtime_seconds
    try:
        value = int(explicit)
    except (TypeError, ValueError):
        return max_runtime_seconds
    if isinstance(explicit, bool):
        return max_runtime_seconds
    return float(max(1, min(86400, value)))


async def _read_stream(stream: asyncio.StreamReader | None, label: str, buffer: _OutputBuffer) -> None:
    if stream is None:
        return
    while True:
        raw = await stream.readline()
        if not raw:
            return
        await buffer.add(label, raw.decode("utf-8", errors="replace"))


async def _wait_exit(proc: _Proc, timeout: float) -> None:
    """Wait until the process exits without cancelling the shared wait task.

    ``wait_for(shield(process.wait()))`` can miss a completion on Python 3.13,
    so a set ``returncode`` is treated as done even if that task is still pending.
    """
    if proc.exit_task.done() or proc.process.returncode is not None:
        await _retire_exit_task(proc)
        return
    await asyncio.wait({proc.exit_task}, timeout=timeout)
    if proc.process.returncode is not None and not proc.exit_task.done():
        await _retire_exit_task(proc)


async def _retire_exit_task(proc: _Proc) -> None:
    if proc.exit_task.done():
        return
    proc.exit_task.cancel()
    await asyncio.wait({proc.exit_task}, timeout=1)


def _signal_group(process: asyncio.subprocess.Process, sig: int) -> None:
    pid = process.pid
    if pid is None:
        return
    try:
        os.killpg(pid, sig)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            process.send_signal(sig)
        except (ProcessLookupError, OSError):
            return


async def _stop_process(proc: _Proc) -> None:
    process = proc.process
    if process.returncode is not None or proc.exit_task.done():
        await _wait_exit(proc, 0)
        return
    _signal_group(process, signal.SIGTERM)
    await _wait_exit(proc, KILL_GRACE_SECONDS)
    if process.returncode is None:
        _signal_group(process, signal.SIGKILL)
        await _wait_exit(proc, KILL_GRACE_SECONDS)


def _session_workdir(session: Any) -> Path | None:
    raw = getattr(session, "workspace_dir", None)
    if not isinstance(raw, str) or not raw:
        return None
    return Path(raw)


class SessionTaskManager:
    """Background bash tasks owned by one session actor."""

    def __init__(
        self,
        *,
        actor: Any,
        continuation: TurnContinuation,
        foreground_seconds: float,
        max_runtime_seconds: float,
        max_running: int,
    ) -> None:
        self._actor = actor
        self._continuation = continuation
        self._foreground_seconds = foreground_seconds
        self._max_runtime_seconds = max_runtime_seconds
        self._max_running = max_running
        self._records: dict[str, TaskRecord] = {}
        self._procs: dict[str, _Proc] = {}
        self._finished: dict[str, asyncio.Event] = {}
        self._mu = asyncio.Lock()

    @property
    def continuation(self) -> TurnContinuation:
        return self._continuation

    @property
    def running_count(self) -> int:
        return sum(1 for record in self._records.values() if record.state == "running")

    def has_running(self) -> bool:
        return self.running_count > 0

    def live_record(self, task_id: str) -> TaskRecord | None:
        record = self._records.get(task_id)
        if record is None:
            return None
        if record.state == "running":
            proc = self._procs.get(task_id)
            if proc is not None:
                record.output = proc.buffer.event_output()
        return record

    def live_records(self) -> list[TaskRecord]:
        refreshed: list[TaskRecord] = []
        for task_id in list(self._records):
            record = self.live_record(task_id)
            if record is not None:
                refreshed.append(record)
        return refreshed

    def install(self, bundle: Any, resolver: PlatformToolResolver) -> None:
        """Register task_* handlers and, when bash_exec is enabled, the background runner."""
        handlers = {
            "task_list": self._handle_list,
            "task_get": self._handle_get,
            "task_kill": self._handle_kill,
        }
        for schema in TASK_TOOL_SCHEMAS:
            name = str(schema["function"]["name"])
            resolver.register(name, schema, handlers[name])
        if self._patch_bash_schema(bundle.tools):
            bundle.session.managed_tool_overrides = {"bash_exec": self.run_bash}

    def _patch_bash_schema(self, tools: list[dict[str, Any]]) -> bool:
        suffix = (
            f" Commands still running after {int(self._foreground_seconds)} seconds "
            "are moved to a background task automatically."
        )
        for tool in tools:
            function = tool.get("function")
            if not isinstance(function, dict) or function.get("name") != "bash_exec":
                continue
            description = function.get("description")
            base = description if isinstance(description, str) else ""
            if not base.endswith(suffix):
                function["description"] = base + suffix
            parameters = function.get("parameters")
            if not isinstance(parameters, dict):
                parameters = {"type": "object", "properties": {}}
                function["parameters"] = parameters
            properties = parameters.get("properties")
            if not isinstance(properties, dict):
                properties = {}
                parameters["properties"] = properties
            properties["run_in_background"] = {
                "type": "boolean",
                "description": (
                    "Start the command as a background task and return its task_id immediately."
                ),
            }
            return True
        return False

    async def run_bash(
        self,
        arguments: dict[str, Any],
        session: Any,
        *,
        confirm_gate: Any,
        emit_event: Any = None,
    ) -> str:
        """Managed replacement for bash_exec."""
        if not isinstance(arguments, dict):
            arguments = {}
        command = str(arguments.get("command", "")).strip()
        background = arguments.get("run_in_background") is True
        hard = _hard_timeout(arguments.get("timeout_sec"), self._max_runtime_seconds)
        prepared = await _bash_exec_prepare(
            command,
            arguments,
            session,
            tool_name="bash_exec",
            confirm_gate=confirm_gate,
            emit_event=emit_event,
        )
        if isinstance(prepared, str):
            return prepared
        try:
            process = await asyncio.create_subprocess_exec(
                *prepared.argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(prepared.cwd) if prepared.cwd else None,
                env=prepared.env,
                start_new_session=True,
            )
        except Exception as exc:
            return f"ERROR: command failed to start: {exc}"
        buffer = _OutputBuffer()
        readers = [
            asyncio.create_task(_read_stream(process.stdout, "stdout", buffer)),
            asyncio.create_task(_read_stream(process.stderr, "stderr", buffer)),
        ]
        exit_task = asyncio.create_task(process.wait())
        proc = _Proc(
            process=process,
            buffer=buffer,
            readers=readers,
            exit_task=exit_task,
            started=time.monotonic(),
            hard=hard,
            command=command,
        )
        workdir = _session_workdir(session)
        wait_s = 0.0 if background else min(self._foreground_seconds, hard)
        done, _pending = await asyncio.wait({exit_task}, timeout=wait_s)
        if exit_task in done:
            await _await_readers(readers)
            return format_bash_result(
                process.returncode,
                buffer.stdout_text(),
                buffer.stderr_text(),
            )
        if not background and hard <= self._foreground_seconds:
            await _stop_now(proc)
            await _await_readers(readers)
            return f"ERROR: command timeout after {int(hard)}s"
        async with self._mu:
            if self.running_count >= self._max_running:
                over_limit = True
                task_id = ""
            else:
                over_limit = False
                task_id = new_ulid()
                self._remember_running(task_id, proc, command, workdir)
        if over_limit:
            await _stop_now(proc)
            await _await_readers(readers)
            return (
                f"ERROR: too many background tasks (max {self._max_running}); "
                "stop one with task_kill first"
            )
        try:
            await self._arm_background(task_id, proc, command)
        except Exception:
            logger.exception("failed to arm background task session=%s", self._actor.session_id)
            await self._drop_unarmed(task_id, proc)
            return "ERROR: failed to record background task"
        partial = buffer.partial_output()
        return (
            f"task_id={task_id}\n"
            "status=running\n"
            "NOTE: The command is still running and has been moved to a background task.\n"
            "You will be notified automatically when it finishes. Do not poll in a loop.\n"
            "Use task_get(task_id) to read output, or task_kill(task_id) to stop it.\n"
            "partial_output:\n"
            f"{partial}"
        )

    def _remember_running(
        self,
        task_id: str,
        proc: _Proc,
        command: str,
        workdir: Path | None,
    ) -> None:
        relative = f"{TASK_LOG_DIR}/{task_id}.log"
        proc.relative_log = relative
        proc.workdir = workdir
        record = TaskRecord(
            task_id=task_id,
            session_id=self._actor.session_id,
            tool_name="bash_exec",
            tool_use_id=None,
            summary=command[:SUMMARY_CHARS],
            state="running",
            created_at=utc_now_iso(),
            log_path=relative,
        )
        self._records[task_id] = record
        self._procs[task_id] = proc
        self._finished[task_id] = asyncio.Event()

    async def _arm_background(self, task_id: str, proc: _Proc, command: str) -> None:
        del command
        record = self._records[task_id]
        if proc.workdir is not None and proc.relative_log is not None:
            await proc.buffer.attach_log(proc.workdir / proc.relative_log)
        tool_use_id = self._actor.adapter.ledger.latest_bound_event_id("bash_exec")
        record.tool_use_id = tool_use_id if isinstance(tool_use_id, str) else None
        key = f"task:{task_id}"
        self._continuation.register_pending(key)
        created = task_created_event(
            task_id=task_id,
            tool_name="bash_exec",
            tool_use_id=record.tool_use_id,
            summary=record.summary,
            log_path=record.log_path,
        )
        await self._actor.append([created])
        elapsed = time.monotonic() - proc.started
        remaining = proc.hard - elapsed
        proc.watch_task = asyncio.create_task(
            self._watch(task_id, remaining),
            name=f"ma-task-{task_id}",
        )

    async def _wait_settled(self, task_id: str) -> TaskRecord | None:
        finished = self._finished.get(task_id)
        if finished is not None:
            await finished.wait()
        return self._records.get(task_id)

    async def _drop_unarmed(self, task_id: str, proc: _Proc) -> None:
        self._continuation.resolve_pending(f"task:{task_id}", None)
        self._records.pop(task_id, None)
        self._procs.pop(task_id, None)
        finished = self._finished.get(task_id)
        if finished is not None and not finished.is_set():
            finished.set()
        await _stop_now(proc)
        await _await_readers(proc.readers)
        await proc.buffer.close()

    async def _watch(self, task_id: str, remaining: float) -> None:
        proc = self._procs.get(task_id)
        if proc is None:
            return
        timed_out = remaining <= 0
        if not timed_out:
            await _wait_exit(proc, remaining)
            timed_out = proc.process.returncode is None and not proc.exit_task.done()
        if timed_out and proc.process.returncode is None:
            _signal_group(proc.process, signal.SIGKILL)
            await _wait_exit(proc, KILL_GRACE_SECONDS)
        await _await_readers(proc.readers)
        async with self._mu:
            if proc.settled or proc.cancelled:
                return
            proc.settled = True
        await self._emit_natural(task_id, proc, timed_out=timed_out)

    async def _emit_natural(self, task_id: str, proc: _Proc, *, timed_out: bool) -> None:
        record = self._records.get(task_id)
        if record is None:
            return
        rc = proc.process.returncode
        output = proc.buffer.event_output()
        duration_ms = int(max(0.0, (time.monotonic() - proc.started) * 1000))
        if timed_out:
            state = "failed"
            error = {"type": "timeout", "message": f"task exceeded {int(proc.hard)}s"}
            result: dict[str, Any] | None = {
                "status": "error",
                "exit_code": rc,
                "output": output,
            }
        elif rc == 0:
            state = "succeeded"
            error = None
            result = {"status": "ok", "exit_code": 0, "output": output}
        else:
            state = "failed"
            error = {"type": "exit_code", "message": f"exit code {rc}"}
            result = {"status": "error", "exit_code": rc, "output": output}
        await self._emit(
            record,
            state=state,  # type: ignore[arg-type]
            error=error,
            result=result,
            wake=True,
            duration_ms=duration_ms,
        )

    async def kill(
        self,
        task_id: str,
        *,
        error_type: str,
        message: str,
        wake: bool,
    ) -> TaskRecord | None:
        """Stop one task. Finished tasks return the current record. Unknown -> None."""
        record = self._records.get(task_id)
        if record is None:
            return None
        if record.state != "running":
            return await self._wait_settled(task_id)
        proc = self._procs.get(task_id)
        if proc is not None:
            proc.cancelled = True
        wait_for_owner = False
        async with self._mu:
            current = self._records.get(task_id)
            if current is None:
                return None
            if current.state != "running" or (proc is not None and proc.settled):
                wait_for_owner = True
            elif proc is not None:
                proc.settled = True
        if wait_for_owner:
            return await self._wait_settled(task_id)
        if proc is not None:
            await _stop_now(proc)
            await _await_readers(proc.readers)
        duration_ms = 0
        if proc is not None:
            duration_ms = int(max(0.0, (time.monotonic() - proc.started) * 1000))
        if record.state != "running":
            return await self._wait_settled(task_id)
        return await self._emit(
            record,
            state="cancelled",
            error={"type": error_type, "message": message},
            result=None,
            wake=wake,
            duration_ms=duration_ms,
        )

    async def _emit(
        self,
        record: TaskRecord,
        *,
        state: TaskState,
        error: dict[str, str] | None,
        result: dict[str, Any] | None,
        wake: bool,
        duration_ms: int,
    ) -> TaskRecord:
        output = ""
        exit_code = None
        if isinstance(result, dict):
            raw_output = result.get("output")
            output = raw_output if isinstance(raw_output, str) else ""
            raw_code = result.get("exit_code")
            if isinstance(raw_code, int) and not isinstance(raw_code, bool):
                exit_code = raw_code
        record.state = state
        record.finished_at = utc_now_iso()
        record.error = error
        record.result_body = result
        record.output = output
        record.exit_code = exit_code
        record.duration_ms = max(0, duration_ms)
        proc = self._procs.get(record.task_id)
        if proc is not None:
            await proc.buffer.close()
        event = task_completed_event(
            record.task_id,
            state=state,
            summary=record.summary,
            result=result,
            error=error,
            duration_ms=record.duration_ms,
        )
        try:
            stored = await self._actor.append([event])
            wake_up = WakeUp("task", stored[0]) if wake and stored else None
            self._continuation.resolve_pending(f"task:{record.task_id}", wake_up)
            return record
        finally:
            finished = self._finished.get(record.task_id)
            if finished is not None and not finished.is_set():
                finished.set()

    async def cancel_all(self, *, error_type: str, message: str) -> None:
        ids = [record.task_id for record in self.live_records() if record.state == "running"]
        if not ids:
            return
        await asyncio.gather(
            *[
                self.kill(task_id, error_type=error_type, message=message, wake=False)
                for task_id in ids
            ]
        )

    async def close(self) -> None:
        await self.cancel_all(error_type="session_closed", message="session closed")

    async def _load_folded(self) -> dict[str, TaskRecord]:
        rows: list[StoredEvent] = []
        cursor = 0
        store = self._actor.service.store
        while True:
            batch = await store.list_events(
                self._actor.tenant_id,
                self._actor.session_id,
                after_seq=cursor,
                limit=500,
                types=list(TASK_EVENT_TYPES),
            )
            rows.extend(batch)
            if len(batch) < 500:
                break
            cursor = batch[-1].seq
        folded = fold_task_events(rows)
        overlay_live_records(folded, self.live_records())
        return folded

    async def _handle_list(self, arguments: dict[str, Any], tool_call_id: str | None) -> str:
        del tool_call_id
        folded = await self._load_folded()
        records = sorted(folded.values(), key=lambda item: item.created_at, reverse=True)
        if arguments.get("state") == "running":
            records = [item for item in records if item.state == "running"]
        payload = {"tasks": [item.to_wire(include_output=False) for item in records]}
        return json.dumps(payload, ensure_ascii=False)

    async def _handle_get(self, arguments: dict[str, Any], tool_call_id: str | None) -> str:
        del tool_call_id
        task_id = str(arguments.get("task_id") or "")
        limit = _output_limit(arguments.get("max_output_chars"))
        folded = await self._load_folded()
        record = folded.get(task_id)
        if record is None:
            return json.dumps({"error": "task not found", "task_id": task_id}, ensure_ascii=False)
        wire = record.to_wire(include_output=True)
        result = wire.get("result")
        if isinstance(result, dict) and isinstance(result.get("output"), str):
            result["output"] = result["output"][-limit:]
        return json.dumps(wire, ensure_ascii=False)

    async def _handle_kill(self, arguments: dict[str, Any], tool_call_id: str | None) -> str:
        del tool_call_id
        task_id = str(arguments.get("task_id") or "")
        folded = await self._load_folded()
        if task_id not in folded and task_id not in self._records:
            return json.dumps({"error": "task not found", "task_id": task_id}, ensure_ascii=False)
        record = await self.kill(
            task_id,
            error_type="killed_by_agent",
            message="stopped by task_kill",
            wake=False,
        )
        if record is None:
            existing = folded.get(task_id)
            if existing is None:
                return json.dumps(
                    {"error": "task not found", "task_id": task_id},
                    ensure_ascii=False,
                )
            record = existing
        return json.dumps(record.to_wire(include_output=False), ensure_ascii=False)


def _output_limit(raw: Any) -> int:
    if raw is None or isinstance(raw, bool):
        return _DEFAULT_GET_CHARS
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return _DEFAULT_GET_CHARS
    return max(1, min(16000, value))


async def _await_readers(readers: Sequence[asyncio.Task[None]]) -> None:
    if not readers:
        return
    await asyncio.gather(*readers, return_exceptions=True)


async def _stop_now(proc: _Proc) -> None:
    await _stop_process(proc)


__all__ = [
    "TASK_TOOL_NAMES",
    "TASK_EVENT_TYPES",
    "TASK_LOG_DIR",
    "OUTPUT_TAIL_BYTES",
    "EVENT_OUTPUT_CHARS",
    "SUMMARY_CHARS",
    "KILL_GRACE_SECONDS",
    "TASK_TOOL_SCHEMAS",
    "TaskState",
    "TaskRecord",
    "fold_task_events",
    "overlay_live_records",
    "format_bash_result",
    "task_created_event",
    "task_completed_event",
    "SessionTaskManager",
]
