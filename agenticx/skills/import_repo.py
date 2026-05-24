#!/usr/bin/env python3
"""Bulk import skills from a GitHub repository.

Author: Damon Li
"""

from __future__ import annotations

import fnmatch
import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_DEFAULT_EXCLUDE = ["**/deprecated/**", "**/in-progress/**"]
_MAX_PER_CALL = 50


@dataclass
class ImportRepoConfig:
    max_per_call: int = _MAX_PER_CALL
    default_exclude: List[str] = field(default_factory=lambda: list(_DEFAULT_EXCLUDE))


@dataclass
class ImportRepoResult:
    installed: List[str] = field(default_factory=list)
    skipped_existing: List[str] = field(default_factory=list)
    pending: List[str] = field(default_factory=list)
    rejected_by_guard: List[Dict[str, str]] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    dry_run: bool = False


def load_import_repo_config() -> ImportRepoConfig:
    cfg = ImportRepoConfig()
    try:
        from agenticx.cli.config_manager import ConfigManager

        section = ConfigManager.get_value("skill_import_repo")
        if isinstance(section, dict):
            if section.get("max_per_call") is not None:
                cfg.max_per_call = max(1, min(50, int(section["max_per_call"])))
            raw_ex = section.get("default_exclude")
            if isinstance(raw_ex, list) and raw_ex:
                cfg.default_exclude = [str(x) for x in raw_ex]
    except Exception:
        pass
    return cfg


def _parse_repo(repo: str) -> Tuple[str, str]:
    text = str(repo or "").strip().strip("/")
    if text.startswith("https://github.com/"):
        text = text.replace("https://github.com/", "", 1)
    parts = [p for p in text.split("/") if p]
    if len(parts) < 2:
        raise ValueError("repo must be owner/name")
    return parts[0], parts[1]


def _github_tree(owner: str, name: str, branch: str) -> List[str]:
    url = f"https://api.github.com/repos/{owner}/{name}/git/trees/{branch}?recursive=1"
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    tree = payload.get("tree") or []
    paths: List[str] = []
    for item in tree:
        if isinstance(item, dict) and item.get("type") == "blob":
            p = str(item.get("path") or "")
            if p:
                paths.append(p)
    return paths


def _matches_glob(path: str, pattern: str) -> bool:
    return fnmatch.fnmatch(path, pattern)


def _filter_skill_paths(
    paths: List[str],
    path_glob: str,
    exclude: List[str],
) -> List[str]:
    skill_paths = [p for p in paths if p.endswith("/SKILL.md") or p.endswith("SKILL.md")]
    out: List[str] = []
    for p in skill_paths:
        if path_glob and not _matches_glob(p, path_glob):
            continue
        if any(_matches_glob(p, ex) for ex in exclude):
            continue
        rel = p
        if rel.startswith("skills/"):
            rel = rel[len("skills/") :]
        if rel.endswith("/SKILL.md"):
            rel = rel[: -len("/SKILL.md")]
        elif rel.endswith("SKILL.md"):
            rel = rel[: -len("SKILL.md")].rstrip("/")
        if rel:
            out.append(rel)
    return sorted(set(out))


def _fetch_raw(owner: str, name: str, branch: str, skill_rel: str) -> str:
    path = f"skills/{skill_rel}/SKILL.md"
    url = f"https://raw.githubusercontent.com/{owner}/{name}/{branch}/{path}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    if len(data) > 1024 * 1024:
        raise ValueError(f"SKILL.md too large for {skill_rel}")
    return data.decode("utf-8")


def _skills_root() -> Path:
    return Path.home() / ".agenticx" / "skills"


def import_skills_from_repo(
    *,
    repo: str,
    branch: str = "main",
    path_glob: str = "skills/**/SKILL.md",
    exclude: Optional[List[str]] = None,
    dry_run: bool = False,
    overwrite: bool = False,
    cfg: Optional[ImportRepoConfig] = None,
) -> ImportRepoResult:
    """Install skills from a GitHub repo into ~/.agenticx/skills/."""
    from agenticx.skills.guard import scan_skill, should_allow

    cfg = cfg or load_import_repo_config()
    result = ImportRepoResult(dry_run=dry_run)
    excl = list(exclude) if exclude else list(cfg.default_exclude)
    try:
        owner, name = _parse_repo(repo)
        paths = _github_tree(owner, name, branch)
    except Exception as exc:
        result.errors.append(str(exc))
        return result

    candidates = _filter_skill_paths(paths, path_glob, excl)
    if len(candidates) > cfg.max_per_call:
        result.errors.append(
            f"too many skills ({len(candidates)}); max_per_call={cfg.max_per_call}. Split into batches."
        )
        return result

    root = _skills_root()
    for skill_rel in candidates:
        target = (root / skill_rel).resolve()
        try:
            target.relative_to(root.resolve())
        except ValueError:
            result.errors.append(f"invalid skill path: {skill_rel}")
            continue
        skill_md = target / "SKILL.md"
        if skill_md.is_file() and not overwrite:
            result.skipped_existing.append(skill_rel)
            continue
        if dry_run:
            result.pending.append(skill_rel)
            continue
        try:
            content = _fetch_raw(owner, name, branch, skill_rel)
        except Exception as exc:
            result.errors.append(f"{skill_rel}: fetch failed: {exc}")
            continue
        try:
            if target.exists():
                import shutil

                shutil.rmtree(target)
            target.mkdir(parents=True, exist_ok=True)
            skill_md.write_text(content, encoding="utf-8")
            scan = scan_skill(target, source="agent-created")
            ok, reason = should_allow(scan, "agent-created")
            if not ok:
                import shutil

                shutil.rmtree(target, ignore_errors=True)
                result.rejected_by_guard.append({"name": skill_rel, "reason": reason or "guard rejected"})
                continue
            try:
                from agenticx.skills.versioning import append_changelog

                append_changelog(target, action="create", summary=f"imported from {repo}@{branch}")
            except Exception:
                pass
            result.installed.append(skill_rel)
        except Exception as exc:
            import shutil

            shutil.rmtree(target, ignore_errors=True)
            result.errors.append(f"{skill_rel}: install failed: {exc}")

    return result


def result_to_json(result: ImportRepoResult) -> str:
    payload: Dict[str, Any] = {
        "dry_run": result.dry_run,
        "installed": result.installed,
        "skipped_existing": result.skipped_existing,
        "pending": result.pending,
        "rejected_by_guard": result.rejected_by_guard,
        "errors": result.errors,
    }
    return json.dumps(payload, ensure_ascii=False)
