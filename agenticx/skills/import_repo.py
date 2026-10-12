#!/usr/bin/env python3
"""Bulk import skills from a GitHub repository.

Author: Damon Li
"""

from __future__ import annotations

import fnmatch
import io
import json
import os
import re
import shutil
import tarfile
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_DEFAULT_EXCLUDE = ["**/deprecated/**", "**/in-progress/**"]
_MAX_PER_CALL = 50

# Full-directory skill install safety caps (tarball path).
_TARBALL_MAX_FILES = 500
_TARBALL_MAX_TOTAL_BYTES = 50 * 1024 * 1024
_TARBALL_MAX_FILE_BYTES = 5 * 1024 * 1024
_SKILL_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


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
    # Populated when the guard rejects with a dangerous verdict and the caller
    # did not pass acknowledge_high_risk — mirrors the registry install UX.
    high_risk_confirm_required: List[str] = field(default_factory=list)
    scan_summary: Optional[Dict[str, Any]] = None


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
        "high_risk_confirm_required": result.high_risk_confirm_required,
        "errors": result.errors,
    }
    if result.scan_summary is not None:
        payload["scan_summary"] = result.scan_summary
    return json.dumps(payload, ensure_ascii=False)


def _download_tarball(owner: str, name: str, branch: str) -> bytes:
    """Download the repo tarball from codeload.github.com (single request, no API rate limits)."""
    url = f"https://codeload.github.com/{owner}/{name}/tar.gz/{branch}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    if len(data) > _TARBALL_MAX_TOTAL_BYTES:
        raise ValueError(
            f"tarball too large ({len(data)} bytes > {_TARBALL_MAX_TOTAL_BYTES})"
        )
    return data


def _strip_tarball_root(member_name: str) -> Optional[str]:
    """Drop the tarball's leading root segment (e.g. 'repo-main/'). Returns None for top-level entries."""
    if "/" not in member_name:
        return None
    rest = member_name.split("/", 1)[1]
    return rest or None


def _extract_skill_dir(
    tarball: bytes,
    *,
    staging: Path,
    prefix: str,
) -> Tuple[int, int, List[str]]:
    """Extract only members under ``prefix`` into ``staging``.

    Returns (file_count, total_bytes, skipped) — skipped lists non-regular
    members (symlinks/devices) that were deliberately not extracted.
    Raises ValueError on unsafe entries (path traversal) or cap violations.
    """
    file_count = 0
    total_bytes = 0
    skipped: List[str] = []
    with tarfile.open(fileobj=io.BytesIO(tarball), mode="r|gz") as tf:
        for member in tf:
            rel = _strip_tarball_root(member.name)
            if rel is None:
                continue
            if rel == prefix:
                inner_parts: List[str] = []
            elif rel.startswith(prefix + "/"):
                inner = rel[len(prefix) + 1:]
                inner_parts = inner.split("/")
            else:
                continue
            if any(p in ("", ".", "..") for p in inner_parts):
                raise ValueError(f"unsafe path in tarball: {member.name}")
            dest = staging.joinpath(*inner_parts) if inner_parts else staging
            if member.isdir():
                dest.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                # symlinks / devices / fifos: never materialize them
                skipped.append(member.name)
                continue
            if member.size > _TARBALL_MAX_FILE_BYTES:
                raise ValueError(f"file too large in tarball: {member.name}")
            file_count += 1
            if file_count > _TARBALL_MAX_FILES:
                raise ValueError(f"too many files in tarball (max {_TARBALL_MAX_FILES})")
            total_bytes += member.size
            if total_bytes > _TARBALL_MAX_TOTAL_BYTES:
                raise ValueError(f"tarball content exceeds {_TARBALL_MAX_TOTAL_BYTES} bytes")
            dest.parent.mkdir(parents=True, exist_ok=True)
            src = tf.extractfile(member)
            if src is None:
                skipped.append(member.name)
                continue
            with src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)
    return file_count, total_bytes, skipped


def install_skill_full_from_repo(
    *,
    repo: str,
    skill: str,
    branch: str = "main",
    repo_subdir: str = "skills",
    overwrite: bool = False,
    dry_run: bool = False,
    acknowledge_high_risk: bool = False,
    cfg: Optional[ImportRepoConfig] = None,
) -> ImportRepoResult:
    """Install one skill's FULL directory (SKILL.md + references/ + scripts/ + assets/)
    from a GitHub repo tarball into ~/.agenticx/skills/registry/<skill>/.

    Deterministic single-tarball download; guard-scans the staged directory and
    leaves any previously installed version untouched when the guard rejects.
    A dangerous verdict blocks the install unless ``acknowledge_high_risk`` is
    set (mirrors the registry install confirm UX).
    """
    from agenticx.skills.guard import scan_skill, should_allow

    _ = cfg  # caps are module-level constants; kept for signature parity
    result = ImportRepoResult(dry_run=dry_run)
    skill = str(skill or "").strip()
    if not skill or not _SKILL_NAME_RE.match(skill):
        result.errors.append(f"invalid skill name: {skill!r}")
        return result
    if not _SKILL_NAME_RE.match(repo_subdir.strip("/")):
        result.errors.append(f"invalid repo_subdir: {repo_subdir!r}")
        return result
    try:
        owner, name = _parse_repo(repo)
    except Exception as exc:
        result.errors.append(str(exc))
        return result

    registry_root = Path.home() / ".agenticx" / "skills" / "registry"
    registry_root.mkdir(parents=True, exist_ok=True)
    target = (registry_root / skill).resolve()
    try:
        target.relative_to(registry_root.resolve())
    except ValueError:
        result.errors.append(f"invalid skill path: {skill}")
        return result

    staging = registry_root / f".tmp-{skill}-{os.getpid()}"
    try:
        try:
            tarball = _download_tarball(owner, name, branch)
        except Exception as exc:
            result.errors.append(f"{skill}: tarball download failed: {exc}")
            return result
        prefix = f"{repo_subdir.strip('/')}/{skill}"
        try:
            file_count, total_bytes, _skipped = _extract_skill_dir(
                tarball, staging=staging, prefix=prefix
            )
        except ValueError as exc:
            result.errors.append(f"{skill}: {exc}")
            return result
        if not (staging / "SKILL.md").is_file():
            result.errors.append(
                f"{skill}: no SKILL.md found under {prefix}/ in {owner}/{name}@{branch}"
            )
            return result

        if dry_run:
            result.pending.append(skill)
            return result

        try:
            scan = scan_skill(staging, source="agent-created")
            ok, reason = should_allow(scan, "agent-created")
            if not ok:
                if scan.verdict == "dangerous" and not acknowledge_high_risk:
                    # Mirror the registry install UX: surface the findings and
                    # let the caller retry with acknowledge_high_risk=True.
                    result.high_risk_confirm_required.append(skill)
                    result.rejected_by_guard.append(
                        {"name": skill, "reason": f"high_risk_confirm_required: {reason}"}
                    )
                    try:
                        from agenticx.skills.guard import scan_result_to_payload

                        result.scan_summary = {
                            "overall": scan.verdict,
                            "skills": [scan_result_to_payload(scan, skill)],
                        }
                    except Exception:
                        pass
                    return result
                if not (scan.verdict == "dangerous" and acknowledge_high_risk):
                    result.rejected_by_guard.append(
                        {"name": skill, "reason": reason or "guard rejected"}
                    )
                    return result
            if target.exists() and not overwrite:
                result.skipped_existing.append(skill)
                return result
            if target.exists():
                shutil.rmtree(target)
            os.rename(staging, target)
            staging = None  # renamed away; nothing to clean up
            try:
                from agenticx.skills.versioning import append_changelog

                append_changelog(
                    target, action="create", summary=f"installed from {repo}@{branch}"
                )
            except Exception:
                pass
            result.installed.append(skill)
            return result
        except Exception as exc:
            result.errors.append(f"{skill}: install failed: {exc}")
            return result
    finally:
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)
