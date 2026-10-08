#!/usr/bin/env python3
"""Tencent SkillHub marketplace search for Near / agx serve.

Attempts the local ``skillhub`` CLI (JSON output) when available; otherwise
falls back to ClawHub results from the user's configured registries, since
SkillHub mirrors that catalog.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


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

        items: List[Dict[str, Any]] = []
        if isinstance(data, list):
            records = data
        elif isinstance(data, dict):
            records = data.get("items") or data.get("results") or data.get("skills") or []
            if not isinstance(records, list):
                continue
        else:
            continue

        for row in records:
            if not isinstance(row, dict):
                continue
            slug = str(row.get("slug") or row.get("name") or "").strip()
            if not slug:
                continue
            display = str(row.get("displayName") or row.get("title") or slug).strip()
            items.append(
                {
                    "slug": slug,
                    "name": display or slug,
                    "description": str(row.get("summary") or row.get("description") or "").strip(),
                    "version": str(row.get("version") or "latest"),
                    "author": str(row.get("author") or row.get("publisher") or "unknown"),
                    "downloads": row.get("downloads") or row.get("downloadCount"),
                }
            )
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


def _install_via_skillhub_cli(slug: str, dest_dir: Path) -> tuple[bool, str]:
    """Download a skill into ``dest_dir`` using the local SkillHub CLI when present."""
    exe = shutil.which("skillhub")
    cli_candidates: List[Path] = []
    if exe:
        cli_candidates.append(Path(exe))
    home_cli = Path.home() / ".skillhub" / "skills_store_cli.py"
    if home_cli.is_file():
        cli_candidates.append(home_cli)

    dest_dir.mkdir(parents=True, exist_ok=True)
    attempts: List[str] = []
    for candidate in cli_candidates:
        if candidate.suffix == ".py":
            base = ["python3", str(candidate), "--skip-self-upgrade"]
        else:
            base = [str(candidate), "--skip-self-upgrade"]
        argv_sets = (
            base + ["install", slug, "--dir", str(dest_dir)],
            base + ["install", slug, "--namespace", "global", "--dir", str(dest_dir)],
            base + ["download", slug, "--dir", str(dest_dir)],
        )
        for argv in argv_sets:
            try:
                proc = subprocess.run(
                    argv,
                    capture_output=True,
                    text=True,
                    timeout=180,
                    check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                attempts.append(f"{' '.join(argv)} -> {exc}")
                continue
            if proc.returncode == 0 and _find_skill_md(dest_dir) is not None:
                return True, ""
            detail = (proc.stderr or proc.stdout or "").strip()[:400]
            attempts.append(f"{' '.join(argv)} rc={proc.returncode}: {detail}")
    if not cli_candidates:
        return False, "SkillHub CLI not found (skillhub / ~/.skillhub/skills_store_cli.py)"
    return False, "; ".join(attempts) or "SkillHub CLI install failed"


def install_skillhub_skill(slug: str) -> Dict[str, Any]:
    """Deterministically install a SkillHub skill into ~/.agenticx/skills/registry/<slug>/.

    Runs outside the agent sandbox (Studio API / Desktop IPC). Writes the full
    skill directory when available and stamps ``source: skillhub``.
    """
    name = str(slug or "").strip()
    if not name:
        return {"ok": False, "error": "slug is required"}

    from agenticx.extensions.registry_hub import RegistryHub
    from agenticx.skills.guard import scan_result_to_payload, scan_skill_markdown_text

    with tempfile.TemporaryDirectory(prefix="agx-skillhub-") as tmp:
        tmp_path = Path(tmp)
        ok, err = _install_via_skillhub_cli(name, tmp_path)
        if not ok:
            return {
                "ok": False,
                "error": err or "skillhub install failed",
                "error_code": "skillhub_cli_failed",
                "fallback_to_agent": True,
            }
        skill_md = _find_skill_md(tmp_path)
        if skill_md is None:
            return {
                "ok": False,
                "error": "downloaded package missing SKILL.md",
                "error_code": "missing_skill_md",
                "fallback_to_agent": True,
            }
        src_dir = skill_md.parent
        content = skill_md.read_text(encoding="utf-8")
        sr = scan_skill_markdown_text(content)
        summary = {
            "overall": sr.verdict,
            "skills": [scan_result_to_payload(sr, name)],
        }
        if sr.verdict == "dangerous":
            return {
                "ok": False,
                "error": "high_risk_confirm_required",
                "error_code": "high_risk_confirm_required",
                "scan_summary": summary,
                "fallback_to_agent": False,
            }
        hub = RegistryHub.from_config()
        md_path = hub.write_registry_skill_dir(name, src_dir, source="skillhub")
        return {
            "ok": True,
            "name": name,
            "slug": name,
            "installed_path": str(md_path),
            "source": "skillhub",
            "scan_summary": summary,
        }

