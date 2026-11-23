"""In-process CodeBuddy Tencent OAuth via official auth/state + token APIs.

Near Desktop opens the authorize URL in the WorkPanel browser and polls job
status until tokens are written into CodeBuddy's credential store.

Important: Homebrew / npm CodeBuddy CLI (2.x) has no ``login`` / ``--no-browser``
subcommand. Interactive slash ``/login`` opens the same Tencent web flow that
these HTTP endpoints drive. Spawning ``codebuddy login`` treats ``login`` as a
chat prompt or fails with unknown options (exit 1).
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

_AUTH_ID = "Tencent-Cloud.coding-copilot"
_PREFIX_PATH = "/plugin"
_PLATFORM = "cli"
_TOKEN_PENDING_CODE = 11217
_DEFAULT_ENDPOINTS = (
    "https://copilot.tencent.com",
    "https://www.codebuddy.cn",
    "https://www.codebuddy.ai",
)


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
    _state: Optional[str] = field(default=None, repr=False)
    _api_base: Optional[str] = field(default=None, repr=False)
    _cancel: bool = field(default=False, repr=False)


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


def classify_codebuddy_oauth_outcome(
    *,
    exit_code: int,
    authorize_url: Optional[str],
    auth_verified: bool,
) -> tuple[CodebuddyOAuthJobStatus, Optional[str]]:
    """Pure success/failure rules for OAuth jobs (unit-tested)."""
    if exit_code != 0:
        return CodebuddyOAuthJobStatus.FAILED, f"codebuddy oauth exited with status {exit_code}"
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


def codebuddy_auth_info_path() -> Path:
    """Path of the CLI credential file CodeBuddy reads after Tencent login."""
    override = (os.environ.get("CODEBUDDY_AUTH_INFO_PATH") or "").strip()
    if override:
        return Path(override).expanduser()
    home = Path.home()
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA") or (home / "AppData" / "Roaming"))
        return base / "CodeBuddyExtension" / "Data" / "Public" / "auth" / f"{_AUTH_ID}.info"
    if sys_platform_is_darwin():
        return (
            home
            / "Library"
            / "Application Support"
            / "CodeBuddyExtension"
            / "Data"
            / "Public"
            / "auth"
            / f"{_AUTH_ID}.info"
        )
    xdg = Path(os.environ.get("XDG_CONFIG_HOME") or (home / ".config"))
    return xdg / "CodeBuddyExtension" / "Data" / "Public" / "auth" / f"{_AUTH_ID}.info"


def sys_platform_is_darwin() -> bool:
    return os.uname().sysname.lower() == "darwin" if hasattr(os, "uname") else False


def resolve_codebuddy_oauth_api_base() -> str:
    """Pick API origin: env override, existing credential domain, then defaults."""
    env = (os.environ.get("CODEBUDDY_OAUTH_API_BASE") or "").strip().rstrip("/")
    if env:
        return env
    path = codebuddy_auth_info_path()
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            domain = str((data.get("auth") or {}).get("domain") or "").strip()
            if domain:
                if domain.startswith("http://") or domain.startswith("https://"):
                    return domain.rstrip("/")
                return f"https://{domain}".rstrip("/")
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            pass
    return _DEFAULT_ENDPOINTS[0]


def _http_json(
    method: str,
    url: str,
    *,
    body: Optional[dict] = None,
    headers: Optional[dict] = None,
    timeout: float = 20.0,
) -> dict:
    payload = None if body is None else json.dumps(body).encode("utf-8")
    req_headers = {
        "Accept": "application/json",
        "User-Agent": "AgenticX-Near-CodeBuddy-OAuth/1.0",
    }
    if payload is not None:
        req_headers["Content-Type"] = "application/json"
    if headers:
        req_headers.update(headers)
    req = Request(url, data=payload, method=method.upper(), headers=req_headers)
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"code": exc.code, "msg": raw or str(exc)}
        if not isinstance(parsed, dict):
            parsed = {"code": exc.code, "msg": str(parsed)}
        parsed.setdefault("code", exc.code)
        return parsed
    except URLError as exc:
        return {"code": -1, "msg": str(exc.reason if hasattr(exc, "reason") else exc)}
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        return {"code": -1, "msg": raw[:200] or "invalid json"}
    return parsed if isinstance(parsed, dict) else {"code": -1, "msg": "invalid json object"}


async def _http_json_async(
    method: str,
    url: str,
    *,
    body: Optional[dict] = None,
    headers: Optional[dict] = None,
    timeout: float = 20.0,
) -> dict:
    return await asyncio.to_thread(
        _http_json, method, url, body=body, headers=headers, timeout=timeout
    )


def _is_token_pending(payload: dict) -> bool:
    code = payload.get("code")
    if code == _TOKEN_PENDING_CODE:
        return True
    msg = str(payload.get("msg") or "").lower()
    return "login ing" in msg or "logging in" in msg or "pending" in msg


def _has_usable_auth_token(auth: Any) -> bool:
    if not isinstance(auth, dict):
        return False
    token = str(auth.get("accessToken") or auth.get("access_token") or "").strip()
    return bool(token)


def _calculate_expires_at(auth: dict) -> dict:
    now_ms = int(time.time() * 1000)
    out = dict(auth)
    out.setdefault("lastRefreshTime", now_ms)
    if not out.get("expiresAt"):
        expires_in = out.get("expiresIn")
        try:
            if expires_in is not None:
                out["expiresAt"] = now_ms + int(float(expires_in) * 1000)
        except (TypeError, ValueError):
            pass
    if not out.get("refreshExpiresAt"):
        refresh_expires_in = out.get("refreshExpiresIn")
        try:
            if refresh_expires_in is not None:
                out["refreshExpiresAt"] = now_ms + int(float(refresh_expires_in) * 1000)
        except (TypeError, ValueError):
            pass
    return out


def write_codebuddy_auth_session(session: dict, *, path: Optional[Path] = None) -> Path:
    """Persist CLI session JSON for CodeBuddy to pick up on next process start."""
    target = path or codebuddy_auth_info_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + f".tmp.{uuid.uuid4().hex}")
    text = json.dumps(session, ensure_ascii=False, indent=2)
    tmp.write_text(text + "\n", encoding="utf-8")
    os.replace(tmp, target)
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass
    return target


def _session_from_token_and_account(auth: dict, account: Optional[dict]) -> dict:
    auth_norm = _calculate_expires_at(auth)
    if account and isinstance(account, dict):
        acct = dict(account)
        acct["lastLogin"] = True
        accounts = [acct]
    else:
        acct = {"lastLogin": True}
        accounts = [acct]
    return {"account": acct, "auth": auth_norm, "accounts": accounts}


async def create_codebuddy_oauth_state(api_base: str) -> tuple[str, str]:
    """POST /v2/plugin/auth/state → (state, authUrl)."""
    url = f"{api_base.rstrip('/')}/v2{_PREFIX_PATH}/auth/state?platform={_PLATFORM}"
    payload = await _http_json_async("POST", url, body={})
    if int(payload.get("code", -1)) != 0:
        raise RuntimeError(str(payload.get("msg") or payload.get("error") or "auth/state failed"))
    data = payload.get("data") or {}
    state = str(data.get("state") or "").strip()
    auth_url = str(data.get("authUrl") or data.get("auth_url") or "").strip()
    if not state or not auth_url:
        raise RuntimeError("auth/state missing state or authUrl")
    # Keep authorize URL on the same origin as the API we poll.
    try:
        parsed = urlparse(auth_url)
        base = urlparse(api_base)
        if parsed.scheme and parsed.netloc and base.netloc and parsed.netloc != base.netloc:
            auth_url = f"{base.scheme}://{base.netloc}{parsed.path}"
            if parsed.query:
                auth_url = f"{auth_url}?{parsed.query}"
    except Exception:
        pass
    return state, auth_url


async def poll_codebuddy_oauth_token(
    api_base: str,
    state: str,
    *,
    timeout_seconds: float,
    should_cancel: Optional[Callable[[], bool]] = None,
    poll_interval: float = 1.5,
) -> dict:
    url = f"{api_base.rstrip('/')}/v2{_PREFIX_PATH}/auth/token?state={state}"
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if should_cancel and should_cancel():
            raise asyncio.CancelledError()
        payload = await _http_json_async("GET", url)
        if _is_token_pending(payload):
            await asyncio.sleep(poll_interval)
            continue
        if int(payload.get("code", -1)) != 0:
            raise RuntimeError(str(payload.get("msg") or "auth/token failed"))
        data = payload.get("data")
        if _has_usable_auth_token(data):
            return data  # type: ignore[return-value]
        await asyncio.sleep(poll_interval)
    raise TimeoutError("等待腾讯授权超时")


async def fetch_codebuddy_account(api_base: str, access_token: str) -> Optional[dict]:
    url = f"{api_base.rstrip('/')}/v2{_PREFIX_PATH}/account"
    payload = await _http_json_async(
        "GET",
        url,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if int(payload.get("code", -1)) != 0:
        return None
    data = payload.get("data")
    return data if isinstance(data, dict) else None


async def verify_codebuddy_tencent_auth(exe: str = "", cwd: str = "", *, timeout_seconds: float = 20.0) -> bool:
    """Best-effort check that a usable CLI credential file exists."""
    del exe, cwd, timeout_seconds  # kept for call-site compatibility
    path = codebuddy_auth_info_path()
    if not path.is_file():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return False
    auth = data.get("auth") if isinstance(data, dict) else None
    return _has_usable_auth_token(auth)


async def _run_oauth_job(job: CodebuddyOAuthJob, *, timeout_seconds: float) -> None:
    try:
        api_base = resolve_codebuddy_oauth_api_base()
        # Prefer CN origin when defaulting and CN endpoint is reachable via existing domain.
        job._api_base = api_base
        state, auth_url = await create_codebuddy_oauth_state(api_base)
        job._state = state
        job.authorize_url = auth_url
        job.status = CodebuddyOAuthJobStatus.AUTHORIZING

        auth = await poll_codebuddy_oauth_token(
            api_base,
            state,
            timeout_seconds=timeout_seconds,
            should_cancel=lambda: job._cancel,
        )
        access = str(auth.get("accessToken") or auth.get("access_token") or "")
        account = await fetch_codebuddy_account(api_base, access) if access else None
        session = _session_from_token_and_account(auth, account)
        write_codebuddy_auth_session(session)
        verified = await verify_codebuddy_tencent_auth()
        job.auth_verified = verified
        status, err = classify_codebuddy_oauth_outcome(
            exit_code=0 if verified else 1,
            authorize_url=job.authorize_url,
            auth_verified=verified,
        )
        job.status = status
        job.error = err
    except asyncio.CancelledError:
        job.status = CodebuddyOAuthJobStatus.FAILED
        job.error = "授权已取消"
        job.auth_verified = False
    except TimeoutError as exc:
        job.status = CodebuddyOAuthJobStatus.FAILED
        job.error = str(exc) or "等待腾讯授权超时"
        job.auth_verified = False
    except Exception as exc:
        job.status = CodebuddyOAuthJobStatus.FAILED
        job.error = str(exc) or "腾讯登录失败"
        job.auth_verified = False
    finally:
        job.finished_at = time.time()


async def start_codebuddy_oauth_login(cwd: str, *, timeout_seconds: float = 600.0) -> CodebuddyOAuthJob:
    """Start Tencent OAuth without spawning a non-existent ``codebuddy login`` CLI."""
    job_id = str(uuid.uuid4())
    job = CodebuddyOAuthJob(job_id=job_id, cwd=_normalize_cwd(cwd))
    async with _lock:
        _jobs[job_id] = job

    async def _watch() -> None:
        await _run_oauth_job(job, timeout_seconds=timeout_seconds)

    asyncio.create_task(_watch())
    # Give the state request a brief head start so the first Desktop poll often
    # already has authorize_url (or a fast failure).
    for _ in range(40):
        if job.authorize_url or job.status == CodebuddyOAuthJobStatus.FAILED:
            break
        await asyncio.sleep(0.05)
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
    "codebuddy_auth_info_path",
    "codebuddy_oauth_job_snapshot",
    "create_codebuddy_oauth_state",
    "fetch_codebuddy_account",
    "get_codebuddy_oauth_job",
    "poll_codebuddy_oauth_token",
    "resolve_codebuddy_oauth_api_base",
    "start_codebuddy_oauth_login",
    "verify_codebuddy_tencent_auth",
    "write_codebuddy_auth_session",
]
