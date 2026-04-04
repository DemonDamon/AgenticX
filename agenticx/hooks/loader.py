"""Directory discovery and dynamic loading for hooks.

Author: Damon Li
"""

from __future__ import annotations

import importlib.util
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .config import check_requirements, is_hook_enabled, load_hook_runtime_config
from .frontmatter import HookMetadata, parse_hook_metadata
from .registry import get_global_hook_registry
from .types import HookHandler

logger = logging.getLogger(__name__)
_LOADED_HOOK_KEYS: set[str] = set()


@dataclass
class HookEntry:
    name: str
    source: str
    base_dir: Path
    metadata_path: Path
    handler_path: Path
    metadata: HookMetadata
    eligible: bool
    missing_requirements: Dict[str, List[str]]


@dataclass
class DeclarativeHookEntry:
    """A declarative hook discovered from a search path."""

    name: str
    source: str
    event: str
    hook_type: str
    config_path: Path
    raw: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Preset hook search paths (similar to build_skill_search_paths)
# ---------------------------------------------------------------------------

_CORE_HOOK_DIRS: List[tuple[str, Path]] = [
    ("bundled", Path(__file__).resolve().parent / "bundled"),
    ("managed", Path.home() / ".agenticx" / "hooks"),
]

_PRESET_HOOK_DIRS: Dict[str, Path] = {
    "cursor_plugins": Path.home() / ".cursor" / "plugins",
    "claude_plugins": Path.home() / ".claude" / "plugins",
}


def build_hook_search_paths(
    workspace_dir: Optional[Path] = None,
    *,
    preset_settings: Optional[Dict[str, Any]] = None,
    custom_paths: Optional[List[str]] = None,
) -> List[tuple[str, Path]]:
    """Build ordered list of ``(source, directory)`` pairs to scan for hooks.

    Core paths are always included. Preset plugin paths
    (``~/.cursor/plugins`` and ``~/.claude/plugins``) are included when their
    corresponding key in *preset_settings* is truthy or
    when *preset_settings* is ``None`` (default-on).  Custom paths from
    ``config.yaml``'s ``hooks.custom_paths`` are appended last.
    """

    paths: List[tuple[str, Path]] = list(_CORE_HOOK_DIRS)

    if workspace_dir:
        paths.append(("workspace", workspace_dir / "hooks"))

    for key, directory in _PRESET_HOOK_DIRS.items():
        enabled = True
        if preset_settings is not None:
            entry = preset_settings.get(key, {})
            if isinstance(entry, dict):
                enabled = bool(entry.get("enabled", True))
            else:
                enabled = bool(entry)
        if enabled:
            paths.append((key, directory))

    for extra in custom_paths or []:
        expanded = Path(extra).expanduser().resolve()
        paths.append(("custom", expanded))

    seen: set[str] = set()
    deduped: List[tuple[str, Path]] = []
    for source, p in paths:
        resolved = str(p.resolve())
        if resolved not in seen:
            seen.add(resolved)
            deduped.append((source, p))
    return deduped


def resolve_hook_dirs(workspace_dir: Path) -> List[tuple[str, Path]]:
    """Legacy entry point — delegates to ``build_hook_search_paths``."""
    return build_hook_search_paths(workspace_dir)


def discover_hooks(workspace_dir: Path, config: Optional[Dict[str, object]] = None) -> List[HookEntry]:
    """Discover hooks from bundled/managed/workspace directories."""

    runtime_cfg = config or load_hook_runtime_config()
    merged: Dict[str, HookEntry] = {}
    for source, root in resolve_hook_dirs(workspace_dir):
        if not root.exists() or not root.is_dir():
            continue
        for child in root.iterdir():
            if not child.is_dir():
                continue
            metadata_path = child / "HOOK.yaml"
            handler_path = child / "handler.py"
            if not metadata_path.exists() or not handler_path.exists():
                continue
            try:
                metadata = parse_hook_metadata(metadata_path)
            except Exception as exc:
                logger.warning("Invalid hook metadata %s: %s", metadata_path, exc)
                continue
            missing = check_requirements(metadata.raw.get("requires", {}))
            eligible = not any(missing.values()) and is_hook_enabled(runtime_cfg, metadata.name, metadata.enabled)
            merged[metadata.name] = HookEntry(
                name=metadata.name,
                source=source,
                base_dir=child,
                metadata_path=metadata_path,
                handler_path=handler_path,
                metadata=metadata,
                eligible=eligible,
                missing_requirements=missing,
            )
    return list(merged.values())


def _load_handler(handler_path: Path, export_name: str) -> HookHandler:
    module_name = f"agenticx_hook_{handler_path.stem}_{abs(hash(handler_path))}"
    spec = importlib.util.spec_from_file_location(module_name, handler_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Failed to load handler spec: {handler_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    handler = getattr(module, export_name, None)
    if not callable(handler):
        raise TypeError(f"Export '{export_name}' in {handler_path} is not callable")
    return handler


def load_hooks(
    workspace_dir: Path,
    config: Optional[Dict[str, object]] = None,
    on_loaded: Optional[Callable[[HookEntry], None]] = None,
) -> int:
    """Load all eligible discovered hooks into the global registry."""

    entries = discover_hooks(workspace_dir, config=config)
    registry = get_global_hook_registry()
    loaded_count = 0
    for entry in entries:
        if not entry.eligible:
            continue
        try:
            handler = _load_handler(entry.handler_path, entry.metadata.export)
            for event_key in entry.metadata.events:
                dedupe_key = (
                    f"{entry.name}|{entry.metadata.export}|{entry.handler_path}|{event_key}"
                )
                if dedupe_key in _LOADED_HOOK_KEYS:
                    continue
                registry.register(event_key, handler)
                _LOADED_HOOK_KEYS.add(dedupe_key)
            loaded_count += 1
            if on_loaded:
                on_loaded(entry)
        except Exception as exc:
            logger.warning("Failed to load hook %s: %s", entry.name, exc)
    return loaded_count


# ---------------------------------------------------------------------------
# Declarative hook discovery (hooks.json / YAML declarative configs)
# ---------------------------------------------------------------------------


def discover_declarative_hooks(
    workspace_dir: Optional[Path] = None,
    *,
    preset_settings: Optional[Dict[str, Any]] = None,
    custom_paths: Optional[List[str]] = None,
    declarative_entries: Optional[List[Dict[str, Any]]] = None,
) -> List["DeclarativeHookConfig"]:
    """Discover declarative hooks from all search paths + inline config.

    Returns a flat list of ``DeclarativeHookConfig`` ready for
    ``DeclarativeHookExecutor``.
    """
    from .declarative import (
        DeclarativeHookConfig,
        parse_agenticx_declarative_yaml,
        parse_cursor_hooks_json,
        parse_hook_script_files,
    )

    all_configs: List[DeclarativeHookConfig] = []

    search_paths = build_hook_search_paths(
        workspace_dir,
        preset_settings=preset_settings,
        custom_paths=custom_paths,
    )

    for source, directory in search_paths:
        if not directory.exists():
            continue

        # File path: treat as explicit hooks.json.
        if directory.is_file() and directory.suffix.lower() == ".json":
            parsed = parse_cursor_hooks_json(directory)
            for cfg in parsed:
                if not cfg.source or cfg.source == "agenticx":
                    cfg.source = source
            all_configs.extend(parsed)
            continue

        if not directory.is_dir():
            continue

        json_paths: List[Path] = []
        script_paths: List[Path] = []

        direct_json = directory / "hooks.json"
        if direct_json.exists():
            json_paths.append(direct_json)

        # Recursive scan for plugin-style hook config files.
        json_paths.extend(directory.rglob("hooks/hooks.json"))

        # Recursive scan for script hooks (e.g. ~/.claude/plugins/**/scripts/hooks/*.js).
        script_paths.extend(directory.rglob("scripts/hooks/*.js"))

        seen_json: set[str] = set()
        for json_path in json_paths:
            key = str(json_path.resolve())
            if key in seen_json:
                continue
            seen_json.add(key)
            parsed = parse_cursor_hooks_json(json_path)
            for cfg in parsed:
                if not cfg.source or cfg.source == "agenticx":
                    cfg.source = source
            all_configs.extend(parsed)

        if script_paths:
            all_configs.extend(parse_hook_script_files(script_paths, source=source))

    if declarative_entries:
        all_configs.extend(parse_agenticx_declarative_yaml(declarative_entries))

    return all_configs


def get_hook_settings_from_config() -> Dict[str, Any]:
    """Read hook-related settings from ``~/.agenticx/config.yaml``."""
    try:
        from agenticx.cli.config_manager import ConfigManager
        preset_paths = ConfigManager.get_value("hooks.preset_paths") or {}
        custom_paths = ConfigManager.get_value("hooks.custom_paths") or []
        declarative = ConfigManager.get_value("hooks.declarative") or []
        disabled = ConfigManager.get_value("hooks.disabled") or []
        return {
            "preset_paths": preset_paths if isinstance(preset_paths, dict) else {},
            "custom_paths": custom_paths if isinstance(custom_paths, list) else [],
            "declarative": declarative if isinstance(declarative, list) else [],
            "disabled": disabled if isinstance(disabled, list) else [],
        }
    except Exception:
        return {"preset_paths": {}, "custom_paths": [], "declarative": [], "disabled": []}


# ---------------------------------------------------------------------------
# Deduplication & classification
# ---------------------------------------------------------------------------

import re as _re

_ENV_VAR_PATTERNS = _re.compile(
    r"\$\{?(?:CLAUDE_PLUGIN_ROOT|CURSOR_PLUGIN_ROOT)\}?|\.\.\/lib\/",
    _re.IGNORECASE,
)


def _normalize_command(cmd: str) -> str:
    """Extract the script filename from a command for dedup grouping."""
    if not cmd:
        return ""
    stripped = cmd.strip().rstrip('"').rstrip("'")
    match = _re.search(r'([^/\\]+\.(js|mjs|ts|py|sh|cmd))(?:\s|"|\'|$)', stripped)
    if match:
        return match.group(1)
    return stripped


def classify_hook(config: "DeclarativeHookConfig") -> str:
    """Return usability classification: ``native``, ``needs_env``, or ``unknown``."""
    cmd = config.command or config.url or config.prompt or ""
    if _ENV_VAR_PATTERNS.search(cmd):
        return "needs_env"
    if cmd.strip():
        return "native"
    return "unknown"


def deduplicate_hooks(
    configs: List["DeclarativeHookConfig"],
) -> List[Dict[str, Any]]:
    """Deduplicate hooks by ``(normalized_command, canonical_event)``.

    Returns a list of dicts, each being the representative hook's
    serialization plus ``duplicate_count``, ``duplicate_sources``,
    and ``usability`` fields.
    """
    from .declarative import DeclarativeHookConfig

    groups: Dict[str, List[DeclarativeHookConfig]] = {}
    for cfg in configs:
        key = f"{_normalize_command(cfg.command or cfg.url or cfg.prompt or '')}||{cfg.canonical_event()}"
        groups.setdefault(key, []).append(cfg)

    result: List[Dict[str, Any]] = []
    for _key, group in groups.items():
        rep = group[0]
        sources = sorted(set(c.source for c in group))
        result.append({
            "name": rep.name,
            "source": rep.source,
            "event": rep.event,
            "type": rep.type,
            "command": rep.command,
            "url": rep.url,
            "prompt": rep.prompt,
            "matcher": rep.matcher,
            "block_on_failure": rep.block_on_failure,
            "timeout_seconds": rep.timeout_seconds,
            "enabled": rep.enabled,
            "source_path": rep.source_path,
            "discovered_via": rep.discovered_via,
            "event_inferred": rep.event_inferred,
            "duplicate_count": len(group),
            "duplicate_sources": sources,
            "usability": classify_hook(rep),
        })
    return result

