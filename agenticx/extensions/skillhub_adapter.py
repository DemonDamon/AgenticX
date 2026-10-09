#!/usr/bin/env python3
"""Tencent SkillHub marketplace search / deterministic install for Near / agx serve.

Attempts the local ``skillhub`` CLI when available; otherwise falls back to
ClawHub results from the user's configured registries (SkillHub mirrors that
catalog). Install always resolves a community ``namespace`` (handle) before
download — the SkillHub API requires ``?slug=&namespace=`` or returns HTTP 404.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

SKILLHUB_SEARCH_URL = os.environ.get(
    "SKILLHUB_SEARCH_URL", "https://api.skillhub.cn/api/v1/search"
).strip() or "https://api.skillhub.cn/api/v1/search"
SKILLHUB_DOWNLOAD_URL_TEMPLATE = os.environ.get(
    "SKILLHUB_PRIMARY_DOWNLOAD_URL_TEMPLATE",
    "https://api.skillhub.cn/api/v1/download?slug={slug}&namespace={namespace}",
).strip() or "https://api.skillhub.cn/api/v1/download?slug={slug}&namespace={namespace}"

_HTTP_STATUS_RE = re.compile(r"HTTP\s+(\d{3})", re.I)


def parse_skillhub_ref(raw: str) -> Tuple[Optional[str], str]:
    """Parse ``@ns/slug``, ``ns/slug``, or bare ``slug`` → ``(namespace|None, slug)``.

    Version suffixes (``@ns/slug@1.0.0`` / ``slug@1.0.0``) are stripped.
    """
    ref = str(raw or "").strip()
    if not ref:
        return None, ""
    namespace: Optional[str] = None
    if ref.startswith("@"):
        parts = ref[1:].split("/", 1)
        if len(parts) == 2 and parts[0] and parts[1]:
            namespace, ref = parts[0].strip(), parts[1].strip()
        else:
            ref = ref[1:].strip()
    elif "/" in ref:
        left, right = ref.split("/", 1)
        if left and right and not left.startswith("http"):
            namespace, ref = left.strip(), right.strip()
    if "@" in ref:
        ref = ref.rsplit("@", 1)[0].strip()
    return namespace, ref


def _namespace_from_row(row: Dict[str, Any]) -> Optional[str]:
    ns = row.get("namespace")
    if isinstance(ns, dict):
        handle = str(ns.get("handle") or "").strip()
        if handle:
            return handle
    for key in ("handle", "namespace_handle", "owner_handle"):
        val = str(row.get(key) or "").strip()
        if val and val.lower() not in {"community", "global", "unknown"}:
            return val
    canonical = ""
    if isinstance(ns, dict):
        canonical = str(ns.get("canonicalName") or "").strip()
    if not canonical:
        canonical = str(row.get("canonicalName") or row.get("canonical_name") or "").strip()
    if canonical.startswith("@"):
        parsed_ns, _ = parse_skillhub_ref(canonical)
        if parsed_ns:
            return parsed_ns
    return None


def _row_to_market_item(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(row, dict):
        return None
    slug = str(row.get("slug") or row.get("name") or "").strip()
    if not slug:
        return None
    # Prefer publicSlug when present (API nest under namespace).
    ns_obj = row.get("namespace") if isinstance(row.get("namespace"), dict) else {}
    public = str(ns_obj.get("publicSlug") or "").strip()
    if public:
        slug = public
    # Strip accidental @ns/ prefix from CLI enterprise display slugs.
    _, bare = parse_skillhub_ref(slug)
    if bare:
        slug = bare
    display = str(row.get("displayName") or row.get("title") or row.get("name") or slug).strip()
    namespace = _namespace_from_row(row)
    author = ""
    pub = row.get("publisher")
    if isinstance(pub, dict):
        author = str(pub.get("name") or "").strip()
    elif pub:
        author = str(pub).strip()
    author = str(
        row.get("author") or author or row.get("owner_name") or namespace or "unknown"
    ).strip() or "unknown"
    item: Dict[str, Any] = {
        "slug": slug,
        "name": display or slug,
        "description": str(row.get("summary") or row.get("description") or "").strip(),
        "version": str(row.get("version") or "latest"),
        "author": author or "unknown",
        "downloads": row.get("downloads") or row.get("downloadCount"),
    }
    if namespace:
        item["namespace"] = namespace
        item["canonical"] = f"@{namespace}/{slug}"
    return item


def _http_get_json(url: str, *, timeout: float = 20.0) -> Any:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "AgenticX-SkillHubAdapter/1.0", "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw) if raw.strip() else None


def _search_via_skillhub_api(query: str, *, limit: int = 20) -> List[Dict[str, Any]]:
    """Hit SkillHub search HTTP API (preserves ``namespace.handle``)."""
    q = (query or "").strip()
    if not q:
        return []
    params = urllib.parse.urlencode({"q": q, "limit": str(limit)})
    url = f"{SKILLHUB_SEARCH_URL}?{params}"
    try:
        data = _http_get_json(url, timeout=20.0)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        logger.info("skillhub API search skipped: %s", exc)
        return []
    records: List[Any] = []
    if isinstance(data, list):
        records = data
    elif isinstance(data, dict):
        records = data.get("results") or data.get("items") or data.get("skills") or []
        if not isinstance(records, list):
            return []
    else:
        return []
    items: List[Dict[str, Any]] = []
    for row in records:
        item = _row_to_market_item(row) if isinstance(row, dict) else None
        if item:
            items.append(item)
    return items


def resolve_skillhub_namespace(
    slug: str,
    namespace: Optional[str] = None,
    *,
    search_fn=None,
) -> Tuple[Optional[str], str]:
    """Resolve community namespace/handle for ``slug``.

    Returns ``(namespace, error)``. ``error`` is empty on success.
    """
    bare = str(slug or "").strip()
    ns = str(namespace or "").strip() or None
    if ns:
        return ns, ""
    if not bare:
        return None, "slug is required"
    search = search_fn or _search_via_skillhub_api
    try:
        rows = search(bare)
    except Exception as exc:  # noqa: BLE001 — surface as resolve failure
        return None, f"skillhub search failed: {exc}"
    exact = [r for r in rows if str(r.get("slug") or "").strip() == bare]
    candidates = exact or rows
    for row in candidates:
        found = str(row.get("namespace") or "").strip()
        if found:
            # Prefer exact slug match.
            if exact and row not in exact:
                continue
            return found, ""
    if exact:
        return None, f"no namespace for slug={bare}"
    return None, f"skill not found in skillhub search: {bare}"


def build_skillhub_download_url_template(namespace: str) -> str:
    """CLI only substitutes ``{slug}``; bake namespace into the template literally."""
    ns = urllib.parse.quote(str(namespace or "").strip(), safe="")
    # Replace {namespace} first so a template without it still works.
    templ = SKILLHUB_DOWNLOAD_URL_TEMPLATE.replace("{namespace}", ns)
    if "{slug}" not in templ:
        # Absolute URL already filled — still require {slug} for CLI fill.
        templ = f"https://api.skillhub.cn/api/v1/download?slug={{slug}}&namespace={ns}"
    return templ


def _short_cli_error(stderr: str, stdout: str, returncode: int) -> Tuple[str, str]:
    """Map CLI output to ``(short_reason, error_code)`` for toast-sized UI."""
    detail = (stderr or stdout or "").strip()
    # Prefer the last non-empty line (CLI prints "Error: ..." last).
    lines = [ln.strip() for ln in detail.splitlines() if ln.strip()]
    tail = lines[-1] if lines else ""
    m = _HTTP_STATUS_RE.search(detail)
    if m:
        status = m.group(1)
        return f"HTTP {status} downloading skill", f"skillhub_http_{status}"
    if "SKILL.md" in detail and ("missing" in detail.lower() or "not found" in detail.lower()):
        return "downloaded package missing SKILL.md", "missing_skill_md"
    if returncode != 0 and tail:
        # Strip leading "Error: " and truncate.
        reason = re.sub(r"^(Error|error|ERROR):\s*", "", tail).strip()
        reason = reason[:160] or f"skillhub CLI rc={returncode}"
        return reason, "skillhub_cli_failed"
    if returncode != 0:
        return f"skillhub CLI rc={returncode}", "skillhub_cli_failed"
    return "skillhub CLI install failed", "skillhub_cli_failed"


def _search_via_skillhub_cli(query: str) -> List[Dict[str, Any]]:
    """Run ``skillhub search`` and parse JSON lines or a JSON array."""
    q = (query or "").strip()
    if not q:
        return []

    exe = shutil.which("skillhub")
    if not exe:
        return []

    argv_sets = (
        [exe, "search", q, "--json"],
        [exe, "search", q, "--format", "json"],
    )
    for argv in argv_sets:
        try:
            proc = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            logger.info("skillhub CLI search skipped: %s", exc)
            continue

        raw = (proc.stdout or "").strip()
        if proc.returncode != 0 or not raw:
            continue

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue

        records: List[Any]
        if isinstance(data, list):
            records = data
        elif isinstance(data, dict):
            records = data.get("items") or data.get("results") or data.get("skills") or []
            if not isinstance(records, list):
                continue
        else:
            continue

        items: List[Dict[str, Any]] = []
        for row in records:
            item = _row_to_market_item(row) if isinstance(row, dict) else None
            if item:
                items.append(item)
        if items:
            return items

    return []


def search_skillhub_market(query: str) -> Dict[str, Any]:
    """Return SkillHub-style search results for the Desktop UI.

    Args:
        query: Free-text search string.

    Returns:
        Dict with keys: ok, items (list of skill dicts), source, optional hint/error.
    """
    q = (query or "").strip()

    # Prefer HTTP API: CLI JSON strips namespace.handle which install needs.
    api_items = _search_via_skillhub_api(q)
    if api_items:
        return {
            "ok": True,
            "items": api_items,
            "count": len(api_items),
            "source": "skillhub_api",
            "hint": "",
        }

    cli_items = _search_via_skillhub_cli(q)
    if cli_items:
        return {
            "ok": True,
            "items": cli_items,
            "count": len(cli_items),
            "source": "skillhub_cli",
            "hint": "",
        }

    try:
        from agenticx.extensions.registry_hub import RegistryHub

        hub = RegistryHub.from_config()
        results = hub.search(q)
    except Exception as exc:
        logger.warning("SkillHub fallback search failed: %s", exc)
        return {
            "ok": False,
            "items": [],
            "count": 0,
            "error": str(exc),
        }

    claw_only = [r for r in results if r.source_type == "clawhub"]
    items: List[Dict[str, Any]] = []
    for r in claw_only:
        extra = r.extra if isinstance(r.extra, dict) else {}
        downloads = extra.get("downloads") or extra.get("downloadCount")
        items.append(
            {
                "slug": r.name,
                "name": r.name,
                "description": r.description,
                "version": r.version,
                "author": r.author,
                "downloads": downloads,
            }
        )

    hint = ""
    if not items and not results:
        hint = (
            "未找到匹配技能。可在本机安装 SkillHub CLI 后重试，"
            "或前往 https://skillhub.tencent.com 浏览。"
        )
    elif not items and results:
        hint = (
            "当前注册表未返回 ClawHub 类结果。请在 ~/.agenticx/config.yaml 的 "
            "extensions.registries 中配置 type: clawhub 的源以启用镜像搜索。"
        )

    return {
        "ok": True,
        "items": items,
        "count": len(items),
        "source": "clawhub_fallback",
        "hint": hint,
    }


def _find_skill_md(root: Path) -> Optional[Path]:
    direct = root / "SKILL.md"
    if direct.is_file():
        return direct
    for path in root.rglob("SKILL.md"):
        if path.is_file():
            return path
    return None


def _install_via_skillhub_cli(
    slug: str,
    dest_dir: Path,
    *,
    namespace: str,
) -> Tuple[bool, str, str]:
    """Download a skill into ``dest_dir`` using the local SkillHub CLI.

    Returns ``(ok, short_error, error_code)``. Empty error/code on success.
    Treats ``rc==0`` without ``SKILL.md`` under ``dest_dir`` as failure.
    """
    exe = shutil.which("skillhub")
    cli_candidates: List[Path] = []
    if exe:
        cli_candidates.append(Path(exe))
    home_cli = Path.home() / ".skillhub" / "skills_store_cli.py"
    if home_cli.is_file():
        cli_candidates.append(home_cli)

    if not cli_candidates:
        return (
            False,
            "SkillHub CLI not found",
            "skillhub_cli_missing",
        )

    dest_dir.mkdir(parents=True, exist_ok=True)
    url_template = build_skillhub_download_url_template(namespace)
    last_error = "skillhub CLI install failed"
    last_code = "skillhub_cli_failed"

    for candidate in cli_candidates:
        if candidate.suffix == ".py":
            base = ["python3", str(candidate), "--skip-self-upgrade"]
        else:
            base = [str(candidate), "--skip-self-upgrade"]
        argv = base + [
            "install",
            slug,
            "--dir",
            str(dest_dir),
            "--force",
            "--primary-download-url-template",
            url_template,
        ]
        try:
            proc = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
        except subprocess.TimeoutExpired:
            last_error, last_code = "skillhub CLI timed out", "skillhub_cli_timeout"
            continue
        except OSError as exc:
            last_error, last_code = f"skillhub CLI spawn failed: {exc}", "skillhub_cli_spawn"
            continue

        skill_md = _find_skill_md(dest_dir)
        if proc.returncode == 0 and skill_md is not None:
            return True, "", ""
        if proc.returncode == 0 and skill_md is None:
            last_error = "CLI rc=0 but no SKILL.md under install dir"
            last_code = "missing_skill_md"
            continue
        last_error, last_code = _short_cli_error(
            proc.stderr or "", proc.stdout or "", proc.returncode
        )
    return False, last_error, last_code


def install_skillhub_skill(slug: str) -> Dict[str, Any]:
    """Deterministically install a SkillHub skill into ~/.agenticx/skills/registry/<slug>/.

    Runs outside the agent sandbox (Studio API / Desktop IPC). Writes the full
    skill directory when available and stamps ``source: skillhub``.

    Accepts bare ``archify`` (resolved via search → namespace) or
    ``@indiv-seafish/archify``.
    """
    raw = str(slug or "").strip()
    if not raw:
        return {
            "ok": False,
            "error": "slug is required",
            "error_code": "skillhub_slug_required",
        }

    parsed_ns, bare = parse_skillhub_ref(raw)
    if not bare:
        return {
            "ok": False,
            "error": "slug is required",
            "error_code": "skillhub_slug_required",
        }

    namespace, resolve_err = resolve_skillhub_namespace(bare, parsed_ns)
    if not namespace:
        short = resolve_err or f"namespace unresolved for {bare}"
        return {
            "ok": False,
            "error": short[:200],
            "error_code": "skillhub_namespace_unresolved",
            "fallback_to_agent": True,
            "slug": bare,
        }

    from agenticx.extensions.registry_hub import RegistryHub
    from agenticx.skills.guard import scan_result_to_payload, scan_skill_markdown_text

    with tempfile.TemporaryDirectory(prefix="agx-skillhub-") as tmp:
        tmp_path = Path(tmp)
        ok, err, err_code = _install_via_skillhub_cli(bare, tmp_path, namespace=namespace)
        if not ok:
            return {
                "ok": False,
                "error": (err or "skillhub install failed")[:200],
                "error_code": err_code or "skillhub_cli_failed",
                "fallback_to_agent": True,
                "slug": bare,
                "namespace": namespace,
            }
        skill_md = _find_skill_md(tmp_path)
        if skill_md is None:
            return {
                "ok": False,
                "error": "downloaded package missing SKILL.md",
                "error_code": "missing_skill_md",
                "fallback_to_agent": True,
                "slug": bare,
                "namespace": namespace,
            }
        src_dir = skill_md.parent
        content = skill_md.read_text(encoding="utf-8")
        sr = scan_skill_markdown_text(content)
        summary = {
            "overall": sr.verdict,
            "skills": [scan_result_to_payload(sr, bare)],
        }
        if sr.verdict == "dangerous":
            return {
                "ok": False,
                "error": "high_risk_confirm_required",
                "error_code": "high_risk_confirm_required",
                "scan_summary": summary,
                "fallback_to_agent": False,
                "slug": bare,
                "namespace": namespace,
            }
        hub = RegistryHub.from_config()
        md_path = hub.write_registry_skill_dir(bare, src_dir, source="skillhub")
        return {
            "ok": True,
            "name": bare,
            "slug": bare,
            "namespace": namespace,
            "canonical": f"@{namespace}/{bare}",
            "installed_path": str(md_path),
            "source": "skillhub",
            "scan_summary": summary,
        }


def uninstall_market_skill(
    name: str,
    *,
    skills_root: Optional[Path] = None,
) -> Dict[str, Any]:
    """Uninstall a SkillHub / registry market skill by short or qualified name.

    Accepts ``archify`` or ``registry/archify``. Removes
    ``~/.agenticx/skills/registry/<bare>/`` (full tree) and reasonably cleans
    ``~/.agenticx/skills/.versions/registry/<bare>/``.

    Returns a payload with ``ok``, ``removed`` paths, ``remaining`` paths, and
    ``name`` / ``bare_name``. ``ok`` is True only when no registry target remains.
    """
    raw = str(name or "").strip().replace("\\", "/").strip("/")
    if not raw:
        return {
            "ok": False,
            "error": "empty skill name",
            "removed": [],
            "remaining": [],
            "name": "",
            "bare_name": "",
        }

    bare = raw.split("/")[-1]
    if raw.startswith("registry/"):
        bare = raw[len("registry/") :].split("/")[0] or bare

    root = (skills_root or (Path.home() / ".agenticx" / "skills")).expanduser()
    root = root.resolve(strict=False)
    registry_root = (root / "registry").resolve(strict=False)
    skill_dir = (registry_root / bare).resolve(strict=False)
    try:
        skill_dir.relative_to(registry_root)
    except ValueError:
        return {
            "ok": False,
            "error": "skill path outside registry root",
            "removed": [],
            "remaining": [str(skill_dir)],
            "name": raw,
            "bare_name": bare,
        }

    removed: List[str] = []
    errors: List[str] = []

    if skill_dir.exists():
        try:
            shutil.rmtree(skill_dir)
            removed.append(str(skill_dir))
        except OSError as exc:
            errors.append(f"rmtree {skill_dir}: {exc}")

    versions_dir = (root / ".versions" / "registry" / bare).resolve(strict=False)
    try:
        versions_dir.relative_to((root / ".versions").resolve(strict=False))
    except ValueError:
        versions_dir = None  # type: ignore[assignment]
    if versions_dir is not None and versions_dir.exists():
        try:
            shutil.rmtree(versions_dir)
            removed.append(str(versions_dir))
        except OSError as exc:
            errors.append(f"rmtree versions {versions_dir}: {exc}")

    remaining: List[str] = []
    if skill_dir.exists():
        remaining.append(str(skill_dir))

    ok = not remaining and not errors
    payload: Dict[str, Any] = {
        "ok": ok,
        "action": "uninstall_market_skill",
        "name": raw,
        "bare_name": bare,
        "removed": removed,
        "remaining": remaining,
        "source": "skillhub",
    }
    if errors:
        payload["errors"] = errors
        payload["error"] = "; ".join(errors)
    elif remaining:
        payload["error"] = f"registry skill still present: {remaining[0]}"
    return payload
