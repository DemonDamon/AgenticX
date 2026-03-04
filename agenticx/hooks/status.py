"""Status reporting for discovered hooks.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

from .loader import HookEntry, discover_hooks


@dataclass
class HookStatusItem:
    name: str
    source: str
    description: str
    events: List[str]
    eligible: bool
    missing_requirements: Dict[str, List[str]]
    metadata_path: str
    handler_path: str


def build_hook_status(workspace_dir: Path, config: Optional[Dict[str, object]] = None) -> List[HookStatusItem]:
    entries: List[HookEntry] = discover_hooks(workspace_dir=workspace_dir, config=config)
    return [
        HookStatusItem(
            name=entry.name,
            source=entry.source,
            description=entry.metadata.description,
            events=entry.metadata.events,
            eligible=entry.eligible,
            missing_requirements=entry.missing_requirements,
            metadata_path=str(entry.metadata_path),
            handler_path=str(entry.handler_path),
        )
        for entry in entries
    ]


def build_hook_status_dicts(
    workspace_dir: Path, config: Optional[Dict[str, object]] = None
) -> List[Dict[str, object]]:
    return [asdict(item) for item in build_hook_status(workspace_dir, config=config)]

