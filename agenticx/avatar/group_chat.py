#!/usr/bin/env python3
"""Group chat management for multi-avatar conversations.

Author: Damon Li
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

GROUPS_ROOT = Path.home() / ".agenticx" / "groups"
GROUP_CONFIG_FILE = "group.yaml"


@dataclass
class GroupChatConfig:
    """Persistent group chat definition."""

    id: str
    name: str
    avatar_ids: List[str] = field(default_factory=list)
    routing: str = "intelligent"  # intelligent | user-directed | meta-routed | round-robin
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v or k in {"id", "name", "avatar_ids", "routing"}}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> GroupChatConfig:
        known = set(cls.__dataclass_fields__)
        filtered = {k: v for k, v in data.items() if k in known}
        return cls(**filtered)


class GroupChatRegistry:
    """CRUD operations for group chats with YAML persistence."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root) if root else GROUPS_ROOT
        self.root.mkdir(parents=True, exist_ok=True)

    def _group_dir(self, group_id: str) -> Path:
        return self.root / group_id

    def _config_path(self, group_id: str) -> Path:
        return self._group_dir(group_id) / GROUP_CONFIG_FILE

    def _read_config(self, group_id: str) -> Optional[GroupChatConfig]:
        path = self._config_path(group_id)
        if not path.exists():
            return None
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            if not isinstance(raw, dict):
                return None
            raw.setdefault("id", group_id)
            return GroupChatConfig.from_dict(raw)
        except Exception:
            return None

    def _write_config(self, config: GroupChatConfig) -> None:
        group_dir = self._group_dir(config.id)
        group_dir.mkdir(parents=True, exist_ok=True)
        path = self._config_path(config.id)
        path.write_text(
            yaml.dump(config.to_dict(), sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )

    def list_groups(self) -> List[GroupChatConfig]:
        groups: List[GroupChatConfig] = []
        if not self.root.exists():
            return groups
        for child in sorted(self.root.iterdir()):
            if not child.is_dir():
                continue
            cfg = self._read_config(child.name)
            if cfg is not None:
                groups.append(cfg)
        return groups

    def get_group(self, group_id: str) -> Optional[GroupChatConfig]:
        return self._read_config(group_id)

    def create_group(
        self,
        name: str,
        avatar_ids: List[str],
        routing: str = "intelligent",
    ) -> GroupChatConfig:
        group_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
        config = GroupChatConfig(
            id=group_id,
            name=name,
            avatar_ids=list(avatar_ids),
            routing=routing,
            created_at=now,
            updated_at=now,
        )
        self._write_config(config)
        return config

    def update_group(self, group_id: str, patch: Dict[str, Any]) -> Optional[GroupChatConfig]:
        config = self._read_config(group_id)
        if config is None:
            return None
        immutable = {"id", "created_at"}
        for key, value in patch.items():
            if key in immutable:
                continue
            if hasattr(config, key):
                setattr(config, key, value)
        config.updated_at = datetime.now(timezone.utc).isoformat()
        self._write_config(config)
        return config

    def delete_group(self, group_id: str) -> bool:
        import shutil
        group_dir = self._group_dir(group_id)
        if not group_dir.exists():
            return False
        try:
            shutil.rmtree(group_dir)
        except OSError:
            return False
        return True
