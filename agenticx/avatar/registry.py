#!/usr/bin/env python3
"""Avatar registry with YAML-backed persistence.

Each avatar is stored as ~/.agenticx/avatars/<id>/avatar.yaml
with its own workspace directory for isolated identity and memory.

Author: Damon Li
"""

from __future__ import annotations

import shutil
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

AVATARS_ROOT = Path.home() / ".agenticx" / "avatars"
AVATAR_CONFIG_FILE = "avatar.yaml"

IDENTITY_TEMPLATE = """# IDENTITY.md - {name}

- Name: {name}
- Role: {role}
- Vibe: Pragmatic, structured, concise, execution-first
- Language: Chinese by default
"""

MEMORY_TEMPLATE = """# MEMORY.md - Long-Term Anchors

## Agent Notes
- Avatar created: {created_at}
- Keep this file short and curated.
"""


@dataclass
class AvatarConfig:
    """Persistent avatar definition."""

    id: str
    name: str
    role: str = ""
    avatar_url: str = ""
    system_prompt: str = ""
    workspace_dir: str = ""
    created_by: str = "manual"
    default_provider: str = ""
    default_model: str = ""
    pinned: bool = False
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v or k in {"id", "name", "pinned"}}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> AvatarConfig:
        known = {f.name for f in field().__class__.__dataclass_fields__.values()} if False else set(cls.__dataclass_fields__)
        filtered = {k: v for k, v in data.items() if k in known}
        return cls(**filtered)


class AvatarRegistry:
    """CRUD operations for avatars with YAML persistence."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root) if root else AVATARS_ROOT
        self.root.mkdir(parents=True, exist_ok=True)

    def _avatar_dir(self, avatar_id: str) -> Path:
        return self.root / avatar_id

    def _config_path(self, avatar_id: str) -> Path:
        return self._avatar_dir(avatar_id) / AVATAR_CONFIG_FILE

    def _read_config(self, avatar_id: str) -> Optional[AvatarConfig]:
        path = self._config_path(avatar_id)
        if not path.exists():
            return None
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            if not isinstance(raw, dict):
                return None
            raw.setdefault("id", avatar_id)
            return AvatarConfig.from_dict(raw)
        except Exception:
            return None

    def _write_config(self, config: AvatarConfig) -> None:
        avatar_dir = self._avatar_dir(config.id)
        avatar_dir.mkdir(parents=True, exist_ok=True)
        path = self._config_path(config.id)
        path.write_text(
            yaml.dump(config.to_dict(), sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )

    def list_avatars(self) -> List[AvatarConfig]:
        """Return all avatars sorted by pinned-first then created_at desc."""
        avatars: List[AvatarConfig] = []
        if not self.root.exists():
            return avatars
        for child in sorted(self.root.iterdir()):
            if not child.is_dir():
                continue
            cfg = self._read_config(child.name)
            if cfg is not None:
                avatars.append(cfg)
        avatars.sort(key=lambda a: (not a.pinned, a.created_at or ""), reverse=False)
        return avatars

    def get_avatar(self, avatar_id: str) -> Optional[AvatarConfig]:
        return self._read_config(avatar_id)

    def create_avatar(
        self,
        name: str,
        role: str = "",
        *,
        avatar_url: str = "",
        system_prompt: str = "",
        created_by: str = "manual",
        default_provider: str = "",
        default_model: str = "",
    ) -> AvatarConfig:
        """Create a new avatar with isolated workspace."""
        avatar_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
        workspace_dir = str(self._avatar_dir(avatar_id) / "workspace")
        config = AvatarConfig(
            id=avatar_id,
            name=name,
            role=role,
            avatar_url=avatar_url,
            system_prompt=system_prompt,
            workspace_dir=workspace_dir,
            created_by=created_by,
            default_provider=default_provider,
            default_model=default_model,
            created_at=now,
            updated_at=now,
        )
        self._write_config(config)
        self._ensure_avatar_workspace(config)
        return config

    def update_avatar(self, avatar_id: str, patch: Dict[str, Any]) -> Optional[AvatarConfig]:
        """Update avatar fields. Returns updated config or None if not found."""
        config = self._read_config(avatar_id)
        if config is None:
            return None
        immutable = {"id", "created_at", "workspace_dir"}
        for key, value in patch.items():
            if key in immutable:
                continue
            if hasattr(config, key):
                setattr(config, key, value)
        config.updated_at = datetime.now(timezone.utc).isoformat()
        self._write_config(config)
        return config

    def delete_avatar(self, avatar_id: str) -> bool:
        """Delete avatar and its workspace."""
        avatar_dir = self._avatar_dir(avatar_id)
        if not avatar_dir.exists():
            return False
        try:
            shutil.rmtree(avatar_dir)
        except OSError:
            return False
        return True

    def _ensure_avatar_workspace(self, config: AvatarConfig) -> Path:
        """Create workspace directory with default identity files."""
        ws = Path(config.workspace_dir)
        ws.mkdir(parents=True, exist_ok=True)
        memory_dir = ws / "memory"
        memory_dir.mkdir(parents=True, exist_ok=True)

        identity_path = ws / "IDENTITY.md"
        if not identity_path.exists():
            identity_path.write_text(
                IDENTITY_TEMPLATE.format(name=config.name, role=config.role or "General Assistant"),
                encoding="utf-8",
            )

        memory_path = ws / "MEMORY.md"
        if not memory_path.exists():
            memory_path.write_text(
                MEMORY_TEMPLATE.format(created_at=config.created_at or "unknown"),
                encoding="utf-8",
            )
        return ws
