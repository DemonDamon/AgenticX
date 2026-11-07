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
    auth_verified: Optional[bool] = None
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    _login_output: str = field(default="", repr=False)
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


def classify_codebuddy_oauth_outcome(
    *,
    exit_code: int,
    authorize_url: Optional[str],
    auth_verified: bool,
) -> tuple[CodebuddyOAuthJobStatus, Optional[str]]:
    """Pure success/failure rules for OAuth jobs (unit-tested)."""
    if exit_code != 0:
        return CodebuddyOAuthJobStatus.FAILED, f"codebuddy login exited with status {exit_code}"
    if not (authorize_url or "").strip():
        return (
            CodebuddyOAuthJobStatus.FAILED,
            "未获取腾讯授权链接；本地凭据可能已失效，请重试",
        )
    if not auth_verified:
        return (
            CodebuddyOAuthJobStatus.FAILED,
            "腾讯登录未完成或凭据校验失败，请重新授权",
        )
    return CodebuddyOAuthJobStatus.SUCCESS, None


def _output_indicates_logged_out(text: str) -> bool:
    lowered = text.lower()
    if any(
        phrase in lowered or phrase in text
        for phrase in ("not logged", "未登录", "login required", "请登录", "请先登录")
    ):
        return True
    return False


def _output_indicates_logged_in(text: str) -> bool:
    lowered = text.lower()
    if _output_indicates_logged_out(text):
        return False
    if any(
        phrase in lowered or phrase in text
        for phrase in (
            "logged in",
            "login successful",
            "already logged",
            "已登录",
            "登录成功",
            "authenticated",
            "authentication complete",
            "auth complete",
        )
    ):
        return True
    # Status probes that exit 0 with an account identifier.
    if re.search(r"@[\w.-]+\.", text) or re.search(r"\buser(id)?\s*[:=]", lowered):
        return True
    return False


async def _best_effort_codebuddy_logout(exe: str, cwd: str) -> None:
    """Clear stale tokens before interactive OAuth (mirrors explicit re-login intent)."""
    for argv in (["logout"], ["auth", "logout"]):
        try:
            proc = await asyncio.create_subprocess_exec(
                exe,
                *argv,
                cwd=cwd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(proc.wait(), timeout=12.0)
        except (asyncio.TimeoutError, FileNotFoundError, OSError, ProcessLookupError):
            continue


async def verify_codebuddy_tencent_auth(exe: str, cwd: str, *, timeout_seconds: float = 20.0) -> bool:
    """Best-effort CLI probe after ``login`` — rejects stale exit-0 short-circuits."""
    probes: tuple[tuple[str, ...], ...] = (
        ("auth", "status"),
        ("whoami"),
        ("status"),
    )
    for extra in probes:
        try:
            proc = await asyncio.create_subprocess_exec(
                exe,
                *extra,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except (FileNotFoundError, OSError):
            continue
        try:
            out_b = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            continue
        text = (out_b[0] or b"").decode(errors="replace")
        if proc.returncode != 0:
            continue
        if _output_indicates_logged_in(text):
            return True
        if _output_indicates_logged_out(text):
            return False
    return False


async def _consume_login_output(job: CodebuddyOAuthJob, *, exe: str) -> None:
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
        if job._login_output:
            job._login_output = f"{job._login_output}\n{line}"
        else:
            job._login_output = line
        if not job.authorize_url:
            found = _extract_authorize_url(line)
            if found:
                job.authorize_url = found
                job.status = CodebuddyOAuthJobStatus.AUTHORIZING
    code = await proc.wait()
    verified = False
    if code == 0:
        verified = _output_indicates_logged_in(job._login_output) or await verify_codebuddy_tencent_auth(
            exe,
            job.cwd,
        )
    job.auth_verified = verified
    status, err = classify_codebuddy_oauth_outcome(
        exit_code=code,
        authorize_url=job.authorize_url,
        auth_verified=verified,
    )
    job.status = status
    job.error = err
    job.finished_at = time.time()


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

    await _best_effort_codebuddy_logout(exe, job.cwd)

    proc: Optional[asyncio.subprocess.Process] = None
    login_argv_variants: tuple[tuple[str, ...], ...] = (
        ("login", "--no-browser"),
        ("login",),
    )
    spawn_error: Optional[Exception] = None
    for login_argv in login_argv_variants:
        try:
            proc = await asyncio.create_subprocess_exec(
                exe,
                *login_argv,
                cwd=job.cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            spawn_error = None
            break
        except Exception as exc:
            spawn_error = exc
            proc = None
    if proc is None:
        job.status = CodebuddyOAuthJobStatus.FAILED
        job.error = str(spawn_error or "failed to spawn codebuddy login")
        job.finished_at = time.time()
        return job

    job._proc = proc

    async def _watch() -> None:
        try:
            await asyncio.wait_for(_consume_login_output(job, exe=exe), timeout=timeout_seconds)
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
        "auth_verified": job.auth_verified,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


__all__ = [
    "CodebuddyOAuthJob",
    "CodebuddyOAuthJobStatus",
    "classify_codebuddy_oauth_outcome",
    "codebuddy_oauth_job_snapshot",
    "get_codebuddy_oauth_job",
    "start_codebuddy_oauth_login",
    "verify_codebuddy_tencent_auth",
]
