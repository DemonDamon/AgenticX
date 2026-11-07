"""In-process CodeBuddy Tencent OAuth via CLI ``login`` (subprocess, not harness REPL).

Near Desktop opens the authorize URL in the WorkPanel browser and polls status until
the CLI exits. Tokens stay in CodeBuddy's own credential store.
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Dict, Optional

_URL_RE = re.compile(r"https://[^\s'\"<>)\]]+", re.I)


class CodebuddyOAuthJobStatus(str, Enum):
    STARTING = "starting"
    AUTHORIZING = "authorizing"
    SUCCESS = "success"
    FAILED = "failed"


@dataclass
class CodebuddyOAuthJob:
    job_id: str
    cwd: str
    status: CodebuddyOAuthJobStatus = CodebuddyOAuthJobStatus.STARTING
    authorize_url: Optional[str] = None
    error: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    _proc: Optional[asyncio.subprocess.Process] = field(default=None, repr=False)


_jobs: Dict[str, CodebuddyOAuthJob] = {}
_lock = asyncio.Lock()


def _normalize_cwd(cwd: str) -> str:
    raw = (cwd or "").strip() or "~"
    try:
        path = Path(raw).expanduser()
        if path.is_dir():
            return str(path.resolve())
    except OSError:
        pass
    return str(Path.home())


def _extract_authorize_url(line: str) -> Optional[str]:
    for match in _URL_RE.finditer(line):
        url = match.group(0).rstrip(".,;)")
        if "tencent" in url.lower() or "qq.com" in url.lower() or "oauth" in url.lower():
            return url
    for match in _URL_RE.finditer(line):
        return match.group(0).rstrip(".,;)")
    return None


async def _consume_login_output(job: CodebuddyOAuthJob) -> None:
    proc = job._proc
    if not proc or proc.stdout is None:
        job.status = CodebuddyOAuthJobStatus.FAILED
        job.error = "login process has no stdout"
        job.finished_at = time.time()
        return
    assert proc.stdout is not None
    while True:
        line_b = await proc.stdout.readline()
        if not line_b:
            break
        try:
            line = line_b.decode(errors="replace").strip()
        except Exception:
            line = ""
        if not line:
            continue
        if not job.authorize_url:
            found = _extract_authorize_url(line)
            if found:
                job.authorize_url = found
                job.status = CodebuddyOAuthJobStatus.AUTHORIZING
    code = await proc.wait()
    job.finished_at = time.time()
    if code == 0:
        job.status = CodebuddyOAuthJobStatus.SUCCESS
        job.error = None
    else:
        job.status = CodebuddyOAuthJobStatus.FAILED
        if not job.error:
            job.error = f"codebuddy login exited with status {code}"


async def start_codebuddy_oauth_login(cwd: str, *, timeout_seconds: float = 600.0) -> CodebuddyOAuthJob:
    """Spawn ``codebuddy login`` in a real OS subprocess (never harness REPL)."""
    from agenticx.wb_bridge.settings import resolve_codebuddy_executable

    job_id = str(uuid.uuid4())
    job = CodebuddyOAuthJob(job_id=job_id, cwd=_normalize_cwd(cwd))
    async with _lock:
        _jobs[job_id] = job

    try:
        exe = resolve_codebuddy_executable()
    except Exception as exc:
        job.status = CodebuddyOAuthJobStatus.FAILED
        job.error = str(exc)
        job.finished_at = time.time()
        return job

    try:
        proc = await asyncio.create_subprocess_exec(
            exe,
            "login",
            cwd=job.cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except Exception as exc:
        job.status = CodebuddyOAuthJobStatus.FAILED
        job.error = str(exc)
        job.finished_at = time.time()
        return job

    job._proc = proc

    async def _watch() -> None:
        try:
            await asyncio.wait_for(_consume_login_output(job), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            job.status = CodebuddyOAuthJobStatus.FAILED
            job.error = "等待腾讯授权超时"
            job.finished_at = time.time()
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        finally:
            job._proc = None

    asyncio.create_task(_watch())
    return job


def get_codebuddy_oauth_job(job_id: str) -> Optional[CodebuddyOAuthJob]:
    return _jobs.get((job_id or "").strip())


def codebuddy_oauth_job_snapshot(job: CodebuddyOAuthJob) -> dict:
    return {
        "job_id": job.job_id,
        "status": job.status.value,
        "authorize_url": job.authorize_url,
        "error": job.error,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


__all__ = [
    "CodebuddyOAuthJob",
    "CodebuddyOAuthJobStatus",
    "codebuddy_oauth_job_snapshot",
    "get_codebuddy_oauth_job",
    "start_codebuddy_oauth_login",
]
