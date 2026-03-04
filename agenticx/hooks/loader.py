"""Directory discovery and dynamic loading for hooks.

Author: Damon Li
"""

from __future__ import annotations

import importlib.util
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional

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


def resolve_hook_dirs(workspace_dir: Path) -> List[tuple[str, Path]]:
    bundled = Path(__file__).resolve().parent / "bundled"
    managed = Path.home() / ".agenticx" / "hooks"
    workspace = workspace_dir / "hooks"
    return [
        ("bundled", bundled),
        ("managed", managed),
        ("workspace", workspace),
    ]


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

