#!/usr/bin/env python3
"""Shared one-click installer for registry-backed skills.

Desktop marketplace cards and the Meta-Agent tool both call this module so a
published skill follows one deterministic flow: resolve source, download,
scan, apply confirmation policy, persist, and refresh the skills list.

Author: Damon Li
"""

from __future__ import annotations

import tempfile
import time
from collections.abc import MutableMapping
from pathlib import Path, PurePosixPath
from typing import Any, Optional
from urllib.parse import urlparse

from agenticx.extensions.registry_hub import RegistryHub, RegistrySkillPackage

PreviewCache = MutableMapping[str, tuple[RegistrySkillPackage, float]]

DEFAULT_PREVIEW_CACHE_TTL_SECONDS = 120.0
_PROCESS_PREVIEW_CACHE: dict[str, tuple[RegistrySkillPackage, float]] = {}

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


def _fetch_package(
    hub: RegistryHub,
    source_name: str,
    skill_name: str,
    *,
    namespace: str,
    preview_cache: Optional[PreviewCache],
) -> tuple[Optional[RegistrySkillPackage], str]:
    cache = preview_cache if preview_cache is not None else _PROCESS_PREVIEW_CACHE
    cache_key = _cache_key(source_name, skill_name, namespace)
    cached = cache.get(cache_key)
    if cached:
        package, expires_at = cached
        if time.monotonic() < expires_at:
            return package, ""
        cache.pop(cache_key, None)

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
            return package, error
        if hub.source_type_for_name(source_name) == "skillhub":
            clawhub_source = hub.source_name_for_type("clawhub")
            if clawhub_source and clawhub_source != source_name:
                try:
                    fallback_package, fallback_error = fetch_package(
                        clawhub_source,
                        skill_name,
                        namespace="",
                    )
                except TypeError as exc:
                    if "namespace" not in str(exc):
                        raise
                    fallback_package, fallback_error = fetch_package(
                        clawhub_source,
                        skill_name,
                    )
                if fallback_package is not None and not fallback_error:
                    if namespace and not fallback_package.namespace:
                        fallback_package.namespace = namespace
                    return fallback_package, ""
                return None, f"{error} | ClawHub fallback: {fallback_error}"
        return package, error

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
        return None, error or "fetch failed"
    return RegistrySkillPackage(files={"SKILL.md": content.encode("utf-8")}), ""


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

    package, fetch_error = _fetch_package(
        active_hub,
        source,
        normalized_name,
        namespace=effective_namespace,
        preview_cache=preview_cache,
    )
    if fetch_error or package is None:
        return {
            "ok": False,
            "error": fetch_error or "fetch failed",
            "source": source,
            "name": normalized_name,
            "namespace": effective_namespace,
        }

    cache = preview_cache if preview_cache is not None else _PROCESS_PREVIEW_CACHE
    cache[_cache_key(source, normalized_name, effective_namespace)] = (
        package,
        time.monotonic() + max(1.0, float(cache_ttl_seconds)),
    )

    from agenticx.skills.guard import scan_result_to_payload

    scan_result = _scan_package(package)
    one = scan_result_to_payload(scan_result, normalized_name)
    return {
        "ok": True,
        "message": f"已完成「{normalized_name}」的安全检查，可以继续安装。",
        "source": source,
        "name": normalized_name,
        "namespace": effective_namespace,
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

    package, fetch_error = _fetch_package(
        active_hub,
        source,
        normalized_name,
        namespace=effective_namespace,
        preview_cache=preview_cache,
    )
    if fetch_error or package is None:
        return {
            "ok": False,
            "error": fetch_error or "fetch failed",
            "source": source,
            "name": normalized_name,
            "namespace": effective_namespace,
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

    if scan_result.verdict == "dangerous" and not acknowledge_high_risk:
        return {
            "ok": False,
            "error": "high_risk_confirm_required",
            "error_code": "high_risk_confirm_required",
            "source": source,
            "name": normalized_name,
            "namespace": effective_namespace,
            "scan_summary": summary,
        }
    if (
        scan_result.verdict in ("safe", "caution")
        and not allow_non_high
        and not confirm_non_high_risk
    ):
        return {
            "ok": False,
            "error": "non_high_risk_confirm_required",
            "error_code": "non_high_risk_confirm_required",
            "source": source,
            "name": normalized_name,
            "namespace": effective_namespace,
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

    cache = preview_cache if preview_cache is not None else _PROCESS_PREVIEW_CACHE
    cache.pop(_cache_key(source, normalized_name, effective_namespace), None)
    return {
        "ok": True,
        "source": source,
        "name": normalized_name,
        "namespace": effective_namespace,
        "installed_path": str(markdown_path),
        "package": {
            "file_count": len(package.files),
            "version": package.version,
        },
        "scan_summary": summary,
    }
