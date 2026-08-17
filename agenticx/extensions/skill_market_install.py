#!/usr/bin/env python3
"""Shared one-click installer for registry-backed skills.

Desktop marketplace cards and the Meta-Agent tool both call this module so a
published skill follows one deterministic flow: resolve source, download,
scan, apply confirmation policy, persist, and refresh the skills list.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
import secrets
import shutil
import stat
import tempfile
import threading
import time
from collections.abc import MutableMapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Optional
from urllib.parse import urlparse

from agenticx.extensions.registry_hub import RegistryHub, RegistrySkillPackage


@dataclass
class PreviewCacheEntry:
    package: RegistrySkillPackage
    expires_at: float
    preview_token: str
    archive_sha256: str
    size_bytes: int
    origin_source: str


PreviewCache = MutableMapping[str, Any]

DEFAULT_PREVIEW_CACHE_TTL_SECONDS = 120.0
DEFAULT_PREVIEW_CACHE_MAX_ENTRIES = 32
DEFAULT_PREVIEW_CACHE_MAX_BYTES = 64 * 1024 * 1024
_PROCESS_PREVIEW_CACHE: dict[str, Any] = {}
_PREVIEW_CACHE_LOCK = threading.RLock()

# Native binaries and scripts can be executable without a filename extension.
# Keep this deliberately structural: ZIP mode bits and stable file signatures
# are evidence of executability, while scan coverage is decided separately.
_EXECUTABLE_MAGICS = (
    b"#!",
    b"\x7fELF",
    b"MZ",
    b"\x00asm",
    b"\xca\xfe\xba\xbe",
    b"\xbe\xba\xfe\xca",
    b"\xfe\xed\xfa\xce",
    b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
    b"\xcf\xfa\xed\xfe",
)


def parse_market_skill_reference(value: str) -> tuple[str, str]:
    """Return ``(slug, namespace)`` for a marketplace coordinate or URL."""
    raw = str(value or "").strip()
    if not raw:
        return "", ""
    lowered = raw.lower()
    for prefix in ("skillhub:", "clawhub:"):
        if lowered.startswith(prefix):
            raw = raw.split(":", 1)[1].strip()
            break

    if raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        parts = [part for part in parsed.path.split("/") if part]
        if parts:
            slug = parts[-1]
            namespace = ""
            if len(parts) >= 2 and parts[-2] not in ("skills", "skill"):
                namespace = parts[-2]
            return slug.strip(), namespace.strip().lstrip("@")

    if raw.startswith("@") and "/" in raw:
        scope, slug = raw.split("/", 1)
        return slug.strip().strip("/"), scope.strip().lstrip("@").strip()
    return raw.strip("/"), ""


def normalize_market_skill_name(value: str) -> str:
    """Normalize a SkillHub package reference to its installable slug.

    SkillHub documentation sometimes renders a package as
    ``@clawhub_<publisher>/<slug>`` while the mirrored registry API installs by
    the globally unique ``slug``.
    """
    return parse_market_skill_reference(value)[0]


def _market_source_hint(value: str) -> str:
    raw = str(value or "").strip().lower()
    if raw.startswith("clawhub:") or "clawhub.ai/" in raw:
        return "clawhub"
    if raw.startswith("skillhub:") or "skillhub.cn/" in raw or "skillhub.tencent.com/" in raw:
        return "skillhub"
    return ""


def load_non_high_risk_auto_install() -> bool:
    """Read the shared non-high-risk install policy (default: enabled)."""
    try:
        from agenticx.cli.config_manager import ConfigManager

        raw = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH) or {}
        skills_block = raw.get("skills") or {}
        if isinstance(skills_block, dict):
            value = skills_block.get("non_high_risk_auto_install")
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.strip().lower() in ("true", "1", "yes", "on")
    except Exception:
        pass
    return True


def resolve_market_source(
    hub: RegistryHub,
    skill_name: str,
    source_name: str = "",
) -> tuple[str, str, str]:
    """Resolve ``(source, normalized_name, error)`` for one install request."""
    normalized_name = normalize_market_skill_name(skill_name)
    if not normalized_name:
        return "", "", "name is required"
    try:
        from agenticx.skills.registry import _validate_skill_name

        normalized_name = _validate_skill_name(normalized_name)
        if normalized_name in (".", ".."):
            raise ValueError("Invalid skill name")
    except ValueError as exc:
        return "", normalized_name, str(exc)

    requested_source = str(source_name or "").strip()
    if requested_source:
        if not hub.source_type_for_name(requested_source):
            return "", normalized_name, f"Registry '{requested_source}' not found in configuration"
        return requested_source, normalized_name, ""

    hinted_type = _market_source_hint(skill_name)
    if hinted_type:
        hinted_source = hub.source_name_for_type(hinted_type)
        if hinted_source:
            return hinted_source, normalized_name, ""

    # SkillHub is the product-facing source. Its API returns complete ZIPs and
    # namespace metadata; ClawHub remains the fallback for mirrored packages.
    fallback = hub.source_name_for_type("skillhub") or hub.source_name_for_type("clawhub")
    if fallback:
        return fallback, normalized_name, ""

    # Compatibility fallback for custom hubs that expose search results but
    # do not advertise a ClawHub source type.
    try:
        results = hub.search(normalized_name)
    except Exception:
        results = []
    exact = [
        item
        for item in results
        if str(item.name or "").strip().lower() == normalized_name.lower()
    ]
    if exact:
        clawhub_hit = next(
            (item for item in exact if item.source_type == "clawhub"),
            exact[0],
        )
        if clawhub_hit.source:
            return clawhub_hit.source, normalized_name, ""
    return "", normalized_name, "No installable SkillHub/ClawHub registry is configured"


def _cache_key(source_name: str, skill_name: str, namespace: str = "") -> str:
    return f"{source_name}:{namespace}:{skill_name}"


def _package_sha256(package: RegistrySkillPackage) -> str:
    """Return a stable digest for the exact validated package contents."""
    digest = hashlib.sha256()
    for file_path in sorted(package.files):
        path_bytes = file_path.encode("utf-8")
        body = package.files[file_path]
        digest.update(len(path_bytes).to_bytes(4, "big"))
        digest.update(path_bytes)
        digest.update(len(body).to_bytes(8, "big"))
        digest.update(body)
        digest.update(b"\x01" if file_path in package.executable_paths else b"\x00")
    return digest.hexdigest()


def _package_size(package: RegistrySkillPackage) -> int:
    return sum(len(body) for body in package.files.values())


def _cleanup_preview_cache(
    cache: PreviewCache,
    *,
    max_entries: int = DEFAULT_PREVIEW_CACHE_MAX_ENTRIES,
    max_bytes: int = DEFAULT_PREVIEW_CACHE_MAX_BYTES,
) -> None:
    """Drop expired/legacy entries, then enforce process memory bounds."""
    now = time.monotonic()
    with _PREVIEW_CACHE_LOCK:
        for key, value in list(cache.items()):
            if not isinstance(value, PreviewCacheEntry) or value.expires_at <= now:
                cache.pop(key, None)

        entries = sorted(
            (
                (key, value)
                for key, value in cache.items()
                if isinstance(value, PreviewCacheEntry)
            ),
            key=lambda item: item[1].expires_at,
        )
        total_bytes = sum(entry.size_bytes for _, entry in entries)
        while entries and (
            len(entries) > max(1, int(max_entries))
            or total_bytes > max(1, int(max_bytes))
        ):
            key, entry = entries.pop(0)
            if cache.pop(key, None) is not None:
                total_bytes -= entry.size_bytes


def _store_preview_entry(
    cache: PreviewCache,
    cache_key: str,
    package: RegistrySkillPackage,
    *,
    origin_source: str,
    ttl_seconds: float = DEFAULT_PREVIEW_CACHE_TTL_SECONDS,
) -> Optional[PreviewCacheEntry]:
    archive_sha256 = _package_sha256(package)
    package.archive_sha256 = package.archive_sha256 or archive_sha256
    entry = PreviewCacheEntry(
        package=package,
        expires_at=time.monotonic() + max(1.0, float(ttl_seconds)),
        preview_token=secrets.token_urlsafe(32),
        archive_sha256=archive_sha256,
        size_bytes=_package_size(package),
        origin_source=origin_source,
    )
    with _PREVIEW_CACHE_LOCK:
        cache[cache_key] = entry
    _cleanup_preview_cache(cache)
    with _PREVIEW_CACHE_LOCK:
        stored = cache.get(cache_key)
    return stored if isinstance(stored, PreviewCacheEntry) else None


def discard_market_skill_preview(
    skill_name: str,
    *,
    source_name: str,
    namespace: str = "",
    preview_token: str = "",
    preview_cache: Optional[PreviewCache] = None,
) -> bool:
    """Discard one pending preview after cancellation or explicit cleanup."""
    cache = preview_cache if preview_cache is not None else _PROCESS_PREVIEW_CACHE
    key = _cache_key(
        str(source_name or "").strip(),
        normalize_market_skill_name(skill_name),
        str(namespace or "").strip().lstrip("@"),
    )
    with _PREVIEW_CACHE_LOCK:
        entry = cache.get(key)
        if not isinstance(entry, PreviewCacheEntry):
            cache.pop(key, None)
            return False
        if preview_token and not secrets.compare_digest(entry.preview_token, preview_token):
            return False
        cache.pop(key, None)
        return True


def _normalized_origin_source(value: str) -> str:
    normalized = str(value or "").strip().lower()
    aliases = {
        "skillhub_api": "skillhub",
        "skillhub_cli": "skillhub",
        "clawhub_registry": "clawhub",
    }
    return aliases.get(normalized, normalized)


def _default_origin_source(source_type: str, source_name: str) -> str:
    normalized = _normalized_origin_source(source_type)
    if normalized == "skillhub":
        return "skillhub_api"
    if normalized == "clawhub":
        return "clawhub_registry"
    return str(source_name or normalized).strip()


def _fetch_package(
    hub: RegistryHub,
    source_name: str,
    skill_name: str,
    *,
    namespace: str,
    origin_source: str,
    preview_cache: Optional[PreviewCache],
) -> tuple[Optional[RegistrySkillPackage], str, str]:
    cache = preview_cache if preview_cache is not None else _PROCESS_PREVIEW_CACHE
    cache_key = _cache_key(source_name, skill_name, namespace)
    raw_source_type = hub.source_type_for_name(source_name)
    source_type = _normalized_origin_source(raw_source_type)
    requested_origin = _normalized_origin_source(origin_source)
    if requested_origin and source_type and requested_origin != source_type:
        return (
            None,
            f"Package origin '{requested_origin}' does not match registry source '{source_type}'",
            source_type,
        )
    _cleanup_preview_cache(cache)
    with _PREVIEW_CACHE_LOCK:
        cached = cache.get(cache_key)
        if isinstance(cached, PreviewCacheEntry):
            return cached.package, "", cached.origin_source

    actual_origin = (
        str(origin_source or "").strip().lower()
        or _default_origin_source(raw_source_type, source_name)
    )

    fetch_package = getattr(hub, "fetch_skill_package", None)
    if callable(fetch_package):
        try:
            package, error = fetch_package(
                source_name,
                skill_name,
                namespace=namespace,
            )
        except TypeError as exc:
            if "namespace" not in str(exc):
                raise
            package, error = fetch_package(source_name, skill_name)
        if package is not None or not error:
            if package is not None and namespace and not package.namespace:
                package.namespace = namespace
            return package, error, actual_origin
        # A publisher-scoped package must never silently degrade to a bare-slug
        # package from another registry.  Callers may retry an explicitly
        # surfaced mirror result whose source and coordinate they can verify.
        return package, error, actual_origin

    # Compatibility for test doubles and older custom RegistryHub adapters.
    try:
        content, error = hub.fetch_skill_markdown(
            source_name,
            skill_name,
            namespace=namespace,
        )
    except TypeError as exc:
        if "namespace" not in str(exc):
            raise
        content, error = hub.fetch_skill_markdown(source_name, skill_name)
    if error or content is None:
        return None, error or "fetch failed", actual_origin
    return (
        RegistrySkillPackage(files={"SKILL.md": content.encode("utf-8")}),
        "",
        actual_origin,
    )


def _scan_package(package: RegistrySkillPackage):
    """Materialize and scan every file in a downloaded package."""
    from agenticx.skills.guard import scan_skill
    from agenticx.skills.guard_score import compute_score_and_grade
    from agenticx.skills.guard_types import (
        SCANNABLE_EXTENSIONS,
        ScanFinding,
        ScanResult,
        merge_verdict,
    )

    with tempfile.TemporaryDirectory(prefix="agx-skill-preview-") as temp_dir:
        skill_dir = Path(temp_dir) / "skill"
        package.materialize(skill_dir)
        result = scan_skill(skill_dir, source="community")

    uncovered_executables: list[ScanFinding] = []
    for file_path, body in package.files.items():
        executable_by_mode = file_path in package.executable_paths
        executable_by_magic = body.startswith(_EXECUTABLE_MAGICS)
        if not executable_by_mode and not executable_by_magic:
            continue

        package_path = PurePosixPath(file_path)
        suffix = package_path.suffix.lower()
        guard_will_scan = (
            suffix in SCANNABLE_EXTENSIONS or package_path.name == "SKILL.md"
        )
        if guard_will_scan:
            try:
                decoded = body.decode("utf-8")
            except UnicodeDecodeError:
                guard_will_scan = False
            else:
                # NUL-bearing payloads are not reliably analyzable as source
                # even when their filename uses a text extension.
                guard_will_scan = "\x00" not in decoded
        if guard_will_scan:
            continue

        evidence = []
        if executable_by_mode:
            evidence.append("archive executable bit")
        if executable_by_magic:
            evidence.append("executable file signature")
        uncovered_executables.append(
            ScanFinding(
                severity="dangerous",
                pattern_name="unscannable_executable",
                matched_text=" and ".join(evidence),
                file_path=file_path,
                line_number=0,
                category="code_execution",
                pattern_id="PKG-EXEC-001",
            )
        )

    if not uncovered_executables:
        return result
    findings = [*result.findings, *uncovered_executables]
    score, grade = compute_score_and_grade(findings)
    return ScanResult(
        verdict=merge_verdict(findings),
        findings=findings,
        source=result.source,
        score=score,
        grade=grade,
        tier=result.tier,
        pattern_set_version=result.pattern_set_version,
    )


def preview_market_skill(
    skill_name: str,
    *,
    source_name: str = "",
    namespace: str = "",
    origin_source: str = "",
    hub: Optional[RegistryHub] = None,
    preview_cache: Optional[PreviewCache] = None,
    cache_ttl_seconds: float = DEFAULT_PREVIEW_CACHE_TTL_SECONDS,
) -> dict[str, Any]:
    """Download and scan a marketplace skill without writing it."""
    active_hub = hub or RegistryHub.from_config()
    parsed_name, parsed_namespace = parse_market_skill_reference(skill_name)
    effective_namespace = str(namespace or parsed_namespace).strip().lstrip("@")
    source, normalized_name, resolve_error = resolve_market_source(
        active_hub,
        parsed_name or skill_name,
        source_name,
    )
    if resolve_error:
        return {"ok": False, "error": resolve_error, "name": normalized_name}

    package, fetch_error, actual_origin = _fetch_package(
        active_hub,
        source,
        normalized_name,
        namespace=effective_namespace,
        origin_source=origin_source,
        preview_cache=preview_cache,
    )
    if fetch_error or package is None:
        return {
            "ok": False,
            "error": fetch_error or "fetch failed",
            "source": source,
            "name": normalized_name,
            "namespace": effective_namespace,
            "origin_source": actual_origin,
        }

    cache = preview_cache if preview_cache is not None else _PROCESS_PREVIEW_CACHE
    cache_key = _cache_key(source, normalized_name, effective_namespace)
    from agenticx.skills.guard import scan_result_to_payload

    scan_result = _scan_package(package)
    one = scan_result_to_payload(scan_result, normalized_name)
    # Start the confirmation TTL only after the potentially expensive scan so
    # the user receives the full window to review and approve the result.
    cached = _store_preview_entry(
        cache,
        cache_key,
        package,
        origin_source=actual_origin,
        ttl_seconds=cache_ttl_seconds,
    )

    # A single package is bounded by the registry validator and therefore
    # should survive cleanup.  Fail closed if custom limits removed it.
    if not isinstance(cached, PreviewCacheEntry):
        return {
            "ok": False,
            "error": "preview_cache_capacity_exceeded",
            "error_code": "preview_cache_capacity_exceeded",
            "source": source,
            "name": normalized_name,
            "namespace": effective_namespace,
            "origin_source": actual_origin,
        }

    return {
        "ok": True,
        "message": f"已完成「{normalized_name}」的安全检查，可以继续安装。",
        "source": source,
        "name": normalized_name,
        "namespace": effective_namespace,
        "origin_source": actual_origin,
        "preview_token": cached.preview_token,
        "archive_sha256": cached.archive_sha256,
        "package": {
            "file_count": len(package.files),
            "version": package.version,
        },
        "scan": {"overall": one["verdict"], "skills": [one]},
    }


def install_market_skill(
    skill_name: str,
    *,
    source_name: str = "",
    namespace: str = "",
    origin_source: str = "",
    preview_token: str = "",
    acknowledge_high_risk: bool = False,
    confirm_non_high_risk: bool = False,
    auto_non_high: Optional[bool] = None,
    provenance_source: str = "registry",
    hub: Optional[RegistryHub] = None,
    preview_cache: Optional[PreviewCache] = None,
) -> dict[str, Any]:
    """Install a marketplace skill using the same policy as Desktop cards."""
    active_hub = hub or RegistryHub.from_config()
    parsed_name, parsed_namespace = parse_market_skill_reference(skill_name)
    effective_namespace = str(namespace or parsed_namespace).strip().lstrip("@")
    source, normalized_name, resolve_error = resolve_market_source(
        active_hub,
        parsed_name or skill_name,
        source_name,
    )
    if resolve_error:
        return {"ok": False, "error": resolve_error, "name": normalized_name}

    cache = preview_cache if preview_cache is not None else _PROCESS_PREVIEW_CACHE
    cache_key = _cache_key(source, normalized_name, effective_namespace)
    _cleanup_preview_cache(cache)
    requires_preview_binding = bool(
        acknowledge_high_risk or confirm_non_high_risk or preview_token
    )
    package: Optional[RegistrySkillPackage]
    actual_origin = _normalized_origin_source(origin_source)
    if requires_preview_binding:
        with _PREVIEW_CACHE_LOCK:
            cached = cache.get(cache_key)
        valid_token = (
            isinstance(cached, PreviewCacheEntry)
            and bool(preview_token)
            and secrets.compare_digest(cached.preview_token, preview_token)
        )
        valid_archive = (
            valid_token
            and isinstance(cached, PreviewCacheEntry)
            and secrets.compare_digest(
                cached.archive_sha256,
                _package_sha256(cached.package),
            )
        )
        if not valid_archive:
            return {
                "ok": False,
                "error": "preview_refresh_required",
                "error_code": "preview_refresh_required",
                "message": "技能包预览已过期或发生变化，请重新检查后确认。",
                "source": source,
                "name": normalized_name,
                "namespace": effective_namespace,
            }
        package = cached.package
        actual_origin = cached.origin_source
        fetch_error = ""
    else:
        package, fetch_error, actual_origin = _fetch_package(
            active_hub,
            source,
            normalized_name,
            namespace=effective_namespace,
            origin_source=origin_source,
            preview_cache=preview_cache,
        )
    if fetch_error or package is None:
        return {
            "ok": False,
            "error": fetch_error or "fetch failed",
            "source": source,
            "name": normalized_name,
            "namespace": effective_namespace,
            "origin_source": actual_origin,
        }

    from agenticx.skills.guard import scan_result_to_payload

    scan_result = _scan_package(package)
    summary = {
        "overall": scan_result.verdict,
        "skills": [scan_result_to_payload(scan_result, normalized_name)],
    }
    allow_non_high = (
        load_non_high_risk_auto_install()
        if auto_non_high is None
        else bool(auto_non_high)
    )

    needs_high_confirmation = (
        scan_result.verdict == "dangerous" and not acknowledge_high_risk
    )
    needs_non_high_confirmation = (
        scan_result.verdict in ("safe", "caution")
        and not allow_non_high
        and not confirm_non_high_risk
    )
    confirmation_entry: Optional[PreviewCacheEntry] = None
    if needs_high_confirmation or needs_non_high_confirmation:
        with _PREVIEW_CACHE_LOCK:
            existing = cache.get(cache_key)
        confirmation_entry = (
            existing
            if isinstance(existing, PreviewCacheEntry)
            else _store_preview_entry(
                cache,
                cache_key,
                package,
                origin_source=actual_origin,
            )
        )
        if confirmation_entry is None:
            return {
                "ok": False,
                "error": "preview_cache_capacity_exceeded",
                "error_code": "preview_cache_capacity_exceeded",
                "source": source,
                "name": normalized_name,
                "namespace": effective_namespace,
                "origin_source": actual_origin,
            }

    if needs_high_confirmation:
        return {
            "ok": False,
            "error": "high_risk_confirm_required",
            "error_code": "high_risk_confirm_required",
            "source": source,
            "name": normalized_name,
            "namespace": effective_namespace,
            "origin_source": actual_origin,
            "preview_token": confirmation_entry.preview_token,
            "archive_sha256": confirmation_entry.archive_sha256,
            "scan_summary": summary,
        }
    if needs_non_high_confirmation:
        return {
            "ok": False,
            "error": "non_high_risk_confirm_required",
            "error_code": "non_high_risk_confirm_required",
            "source": source,
            "name": normalized_name,
            "namespace": effective_namespace,
            "origin_source": actual_origin,
            "preview_token": confirmation_entry.preview_token,
            "archive_sha256": confirmation_entry.archive_sha256,
            "scan_summary": summary,
        }

    provenance = "skillhub" if provenance_source == "skillhub" else "registry"
    write_package = getattr(active_hub, "write_registry_skill_package", None)
    if callable(write_package):
        markdown_path = write_package(
            normalized_name,
            package,
            source=provenance,
        )
    else:
        markdown_path = active_hub.write_registry_skill(
            normalized_name,
            package.skill_markdown,
            source=provenance,
        )
    try:
        from agenticx.studio.skills_list_api import invalidate_skills_list_cache

        invalidate_skills_list_cache()
    except Exception:
        # Installation succeeded; a later explicit refresh can still repopulate
        # the list if the Studio cache module is unavailable in a CLI context.
        pass

    with _PREVIEW_CACHE_LOCK:
        cache.pop(cache_key, None)
    return {
        "ok": True,
        "source": source,
        "name": normalized_name,
        "namespace": effective_namespace,
        "origin_source": actual_origin,
        "installed_path": str(markdown_path),
        "package": {
            "file_count": len(package.files),
            "version": package.version,
        },
        "scan_summary": summary,
    }


def uninstall_market_skill(
    skill_name: str,
    *,
    install_root: Optional[Path] = None,
) -> dict[str, Any]:
    """Remove one registry-installed skill without crossing ownership bounds.

    Marketplace uninstall is intentionally narrower than the general skill
    management API.  It only owns direct children of the registry install
    root, and it requires the installer-written provenance sidecar before
    deleting the complete package directory.
    """
    from agenticx.skills.frontmatter import SKILL_PROVENANCE_FILENAME
    from agenticx.skills.registry import _validate_skill_name

    normalized_name = normalize_market_skill_name(skill_name)
    try:
        validated_name = _validate_skill_name(normalized_name)
        if validated_name in (".", ".."):
            raise ValueError("Invalid skill name")
    except ValueError as exc:
        return {
            "ok": False,
            "removed": False,
            "name": normalized_name,
            "error": str(exc),
            "error_code": "invalid_skill_name",
        }

    root_input = (
        Path(install_root)
        if install_root is not None
        else Path.home() / ".agenticx" / "skills" / "registry"
    ).expanduser()
    root = root_input.resolve(strict=False)
    candidate = root / validated_name

    # lstat distinguishes an absent target from a broken symlink.  Never call
    # resolve() first: doing so would follow the exact top-level link that this
    # ownership boundary must reject.
    try:
        candidate_stat = candidate.lstat()
    except FileNotFoundError:
        return {
            "ok": True,
            "removed": False,
            "name": validated_name,
        }
    except OSError as exc:
        return {
            "ok": False,
            "removed": False,
            "name": validated_name,
            "error": f"Unable to inspect installed skill: {exc}",
            "error_code": "uninstall_inspection_failed",
        }

    if stat.S_ISLNK(candidate_stat.st_mode):
        return {
            "ok": False,
            "removed": False,
            "name": validated_name,
            "error": "Refusing to uninstall a symlinked skill directory",
            "error_code": "unsafe_install_target",
        }
    if not stat.S_ISDIR(candidate_stat.st_mode):
        return {
            "ok": False,
            "removed": False,
            "name": validated_name,
            "error": "Installed skill target is not a directory",
            "error_code": "unsafe_install_target",
        }

    try:
        skill_dir = candidate.resolve(strict=True)
        skill_dir.relative_to(root)
    except (OSError, ValueError) as exc:
        return {
            "ok": False,
            "removed": False,
            "name": validated_name,
            "error": f"Installed skill path is outside the registry root: {exc}",
            "error_code": "unsafe_install_target",
        }
    if skill_dir == root or skill_dir.parent != root:
        return {
            "ok": False,
            "removed": False,
            "name": validated_name,
            "error": "Installed skill path is not a direct registry child",
            "error_code": "unsafe_install_target",
        }

    provenance_path = skill_dir / SKILL_PROVENANCE_FILENAME
    try:
        provenance_stat = provenance_path.lstat()
    except (FileNotFoundError, OSError):
        provenance_stat = None
    if (
        provenance_stat is None
        or stat.S_ISLNK(provenance_stat.st_mode)
        or not stat.S_ISREG(provenance_stat.st_mode)
    ):
        return {
            "ok": False,
            "removed": False,
            "name": validated_name,
            "error": "Registry install provenance is missing or unsafe",
            "error_code": "invalid_install_provenance",
        }
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        provenance = None
    provenance_source = (
        str(provenance.get("source", "")).strip().lower()
        if isinstance(provenance, dict)
        else ""
    )
    if provenance_source not in {"registry", "skillhub"}:
        return {
            "ok": False,
            "removed": False,
            "name": validated_name,
            "error": "Skill was not installed by the registry marketplace",
            "error_code": "invalid_install_provenance",
        }

    try:
        shutil.rmtree(skill_dir)
    except OSError as exc:
        return {
            "ok": False,
            "removed": False,
            "name": validated_name,
            "error": f"Skill uninstall failed: {exc}",
            "error_code": "uninstall_failed",
        }

    try:
        from agenticx.studio.skills_list_api import invalidate_skills_list_cache

        invalidate_skills_list_cache()
    except Exception:
        # Deletion succeeded; an explicit UI refresh can repopulate the list
        # if Studio cache helpers are unavailable in a CLI-only context.
        pass
    return {
        "ok": True,
        "removed": True,
        "name": validated_name,
    }
