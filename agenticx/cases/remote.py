#!/usr/bin/env python3
"""Remote context-service client — case/wiki cloud push & retrieval (SP-F2).

Sync httpx wrapper over the enterprise context-service API (SP-F contract):
project wiki pages and compiled case entries are pushed once into the shared
company library, then later projects consume them via remote search / init.

Config precedence: explicit args > env vars > defaults.
- AGX_CONTEXT_SERVICE_URL (default http://localhost:8420)
- AGX_CONTEXT_SERVICE_TOKEN (required — clear error when missing)

Every request carries x-agx-internal-token; non-2xx raises RuntimeError with
a response-body summary; connection failures raise RuntimeError with a hint
to check the service / env vars.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import Any

import httpx

from agenticx.cases.model import parse_case_md

DEFAULT_SERVICE_URL = "http://localhost:8420"
ENV_SERVICE_URL = "AGX_CONTEXT_SERVICE_URL"
ENV_SERVICE_TOKEN = "AGX_CONTEXT_SERVICE_TOKEN"

_TIMEOUT_S = 30.0
# wiki push compiles per page server-side (LLM, slow) — generous client timeout.
_PUSH_TIMEOUT_S = 600.0


def _service_config(url: str | None = None, token: str | None = None) -> tuple[str, str]:
    """Resolve (base_url, token): explicit args > env vars > defaults."""
    base = str(url or os.environ.get(ENV_SERVICE_URL) or DEFAULT_SERVICE_URL)
    base = base.strip().rstrip("/")
    resolved_token = str(token or os.environ.get(ENV_SERVICE_TOKEN) or "").strip()
    if not resolved_token:
        raise RuntimeError(
            "缺少 context-service 访问 token：请通过 --token 参数或环境变量 "
            f"{ENV_SERVICE_TOKEN} 提供（与服务端 CONTEXT_SERVICE_INTERNAL_TOKEN 一致）"
        )
    return base, resolved_token


def _page_name(rel_path: str) -> str:
    """Relative wiki path → contract-legal document name.

    "synthesis/portal-guide.md" → "synthesis__portal-guide": "/" becomes "__"
    and the ".md" suffix is dropped (the service stores ``{name}.md``).
    Characters outside the service name rule
    (``^[A-Za-z0-9][A-Za-z0-9._-]*$``, names are joined into server-side file
    paths) collapse to "_", leading separators are dropped. When the transform
    loses characters, a short path hash is appended so distinct source files
    stay distinct server-side (e.g. two Chinese-named pages must not
    overwrite each other).
    """
    joined = rel_path.replace("\\", "/")
    if joined.endswith(".md"):
        joined = joined[: -len(".md")]
    joined = joined.replace("/", "__")
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", joined).lstrip("._-") or "page"
    if name != joined:
        digest = hashlib.md5(rel_path.encode("utf-8")).hexdigest()[:8]
        name = f"{name}-{digest}"
    return name


def _request(
    method: str,
    path: str,
    *,
    base_url: str,
    token: str,
    json: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
    timeout: float = _TIMEOUT_S,
) -> dict[str, Any]:
    """One authenticated request; non-2xx → RuntimeError with a body summary."""
    try:
        with httpx.Client(
            base_url=base_url,
            headers={"x-agx-internal-token": token},
            timeout=timeout,
            trust_env=False,
        ) as client:
            response = client.request(method, path, json=json, params=params)
    except httpx.HTTPError as exc:
        raise RuntimeError(
            f"无法连接 context-service（{base_url}）: {exc}。"
            f"请确认服务已启动，或用 --url / 环境变量 {ENV_SERVICE_URL} 指定地址。"
        ) from exc
    if not 200 <= response.status_code < 300:
        summary = " ".join((response.text or "").split())[:300]
        raise RuntimeError(
            f"context-service 请求失败: {method} {path} → HTTP {response.status_code}"
            + (f": {summary}" if summary else "")
        )
    try:
        return response.json()
    except ValueError:
        return {"ok": False, "raw": response.text}


def push_wiki(
    wiki_dir: str | Path,
    *,
    url: str | None = None,
    token: str | None = None,
    compile: bool = True,  # noqa: A002 — contract field name
) -> dict[str, Any]:
    """Push every *.md page under `wiki_dir` into the shared company wiki.

    Returns the service stats dict: {"ok", "ingested", "compiled", "errors"}.
    """
    root = Path(wiki_dir).expanduser()
    if not root.is_dir():
        raise RuntimeError(f"wiki 目录不存在: {wiki_dir}")
    pages: list[dict[str, str]] = []
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root).as_posix()
        pages.append(
            {"name": _page_name(rel), "text": path.read_text(encoding="utf-8")}
        )
    if not pages:
        raise RuntimeError(f"{wiki_dir} 下没有 .md 页面，未推送任何内容")
    base, resolved_token = _service_config(url, token)
    return _request(
        "POST",
        "/context/wiki/push",
        base_url=base,
        token=resolved_token,
        json={"pages": pages, "compile": bool(compile)},
        timeout=_PUSH_TIMEOUT_S,
    )


def push_case(
    md_path: str | Path,
    *,
    url: str | None = None,
    token: str | None = None,
) -> dict[str, Any]:
    """Push one compiled case-entry markdown to the cloud case library.

    POST /context/ingest {name: case_id, text} + POST /context/compile {name}.
    Returns {"ingest": ..., "compile": ...} service payloads.
    """
    path = Path(md_path).expanduser()
    if not path.is_file():
        raise RuntimeError(f"case 文件不存在: {md_path}")
    case_id = parse_case_md(path).case_id
    if not case_id:
        raise RuntimeError(f"case-entry 缺少 case_id，无法上报: {md_path}")
    text = path.read_text(encoding="utf-8")
    base, resolved_token = _service_config(url, token)
    ingested = _request(
        "POST",
        "/context/ingest",
        base_url=base,
        token=resolved_token,
        json={"name": case_id, "text": text},
    )
    compiled = _request(
        "POST",
        "/context/compile",
        base_url=base,
        token=resolved_token,
        json={"name": case_id},
        timeout=_PUSH_TIMEOUT_S,
    )
    return {"ingest": ingested, "compile": compiled}


def search_cases_remote(
    query: str,
    *,
    scope_filter: dict[str, str] | None = None,
    top_k: int = 5,
    url: str | None = None,
    token: str | None = None,
) -> list[dict[str, Any]]:
    """Search the cloud case library; returns the raw case dicts."""
    base, resolved_token = _service_config(url, token)
    payload: dict[str, Any] = {
        "query": str(query or ""),
        "scope_filter": {str(k): str(v) for k, v in (scope_filter or {}).items()},
        "top_k": int(top_k),
    }
    result = _request(
        "POST",
        "/context/cases/search",
        base_url=base,
        token=resolved_token,
        json=payload,
    )
    cases = result.get("cases") if isinstance(result, dict) else None
    if not isinstance(cases, list):
        return []
    return [item for item in cases if isinstance(item, dict)]


def get_case_remote(
    case_id: str,
    *,
    url: str | None = None,
    token: str | None = None,
) -> str:
    """Fetch one case-entry markdown original text from the cloud library."""
    base, resolved_token = _service_config(url, token)
    result = _request(
        "GET",
        "/context/cases/get",
        base_url=base,
        token=resolved_token,
        params={"case_id": str(case_id)},
    )
    content = result.get("content") if isinstance(result, dict) else None
    if not isinstance(content, str):
        raise RuntimeError(f"context-service 返回缺少 content 字段: case_id={case_id}")
    return content
