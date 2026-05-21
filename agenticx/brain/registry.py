"""BrainRegistry — CRUD + bootstrap migration."""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from agenticx.studio.kb.contracts import KBConfig

from .types import (
    Brain,
    BrainScope,
    BrainStats,
    BrainType,
    CodeBrainConfig,
    new_brain_id,
    utc_now_iso,
)

logger = logging.getLogger(__name__)

AGENTICX_HOME = Path(os.path.expanduser("~/.agenticx"))
BRAINS_ROOT = AGENTICX_HOME / "brains"
REGISTRY_FILE = BRAINS_ROOT / "registry.json"
CONFIG_YAML = AGENTICX_HOME / "config.yaml"
AVATARS_ROOT = AGENTICX_HOME / "avatars"

DEFAULT_DOCS_BRAIN_ID = "default_docs"
LEGACY_KB_REGISTRY = AGENTICX_HOME / "storage" / "kb"


class BrainError(Exception):
    pass


class BrainRegistry:
    _lock = threading.RLock()
    _instance: Optional["BrainRegistry"] = None

    @classmethod
    def instance(cls) -> "BrainRegistry":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @classmethod
    def reset_for_tests(cls) -> None:
        with cls._lock:
            cls._instance = None

    def __init__(self) -> None:
        self._data_lock = threading.RLock()
        self.bootstrap()

    # ------------------------------------------------------------------ #

    def bootstrap(self) -> None:
        """One-time migration from singleton knowledge_base."""
        with self._data_lock:
            BRAINS_ROOT.mkdir(parents=True, exist_ok=True)
            if REGISTRY_FILE.exists():
                return
            legacy_cfg = self._load_legacy_kb_config()
            brain_id = DEFAULT_DOCS_BRAIN_ID
            storage = BRAINS_ROOT / brain_id
            storage.mkdir(parents=True, exist_ok=True)
            cfg_dict = legacy_cfg.to_dict()
            # Keep chroma + document registry paths unchanged (AC-4).
            brain = Brain(
                id=brain_id,
                name="默认文档库",
                type=BrainType.DOCS,
                scope=BrainScope.GLOBAL,
                storage_root=str(storage),
                enabled=legacy_cfg.enabled,
                description="从旧版全局知识库自动迁移",
                owner_avatar_id=None,
                config=cfg_dict,
                stats=BrainStats(),
                created_at=utc_now_iso(),
                updated_at=utc_now_iso(),
            )
            self._write_brain_yaml(brain)
            self._write_registry([brain_id])
            logger.info("brain.bootstrap created default docs brain id=%s", brain_id)

    def _load_legacy_kb_config(self) -> KBConfig:
        if not CONFIG_YAML.exists():
            return KBConfig()
        try:
            raw = yaml.safe_load(CONFIG_YAML.read_text(encoding="utf-8")) or {}
        except Exception:
            raw = {}
        node = raw.get("knowledge_base") if isinstance(raw, dict) else None
        return KBConfig.from_dict(node if isinstance(node, dict) else None)

    def _read_registry_ids(self) -> List[str]:
        if not REGISTRY_FILE.exists():
            return []
        try:
            data = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
        ids = data.get("brains") if isinstance(data, dict) else data
        if not isinstance(ids, list):
            return []
        return [str(x) for x in ids if str(x).strip()]

    def _write_registry(self, ids: List[str]) -> None:
        REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
        REGISTRY_FILE.write_text(
            json.dumps({"brains": ids, "version": 1}, indent=2),
            encoding="utf-8",
        )

    def _brain_yaml_path(self, brain_id: str, *, storage_root: Optional[str] = None) -> Path:
        if storage_root:
            return Path(storage_root) / "brain.yaml"
        for b in self._iter_brain_paths(brain_id):
            p = b / "brain.yaml"
            if p.exists():
                return p
        return BRAINS_ROOT / brain_id / "brain.yaml"

    def _iter_brain_paths(self, brain_id: str) -> List[Path]:
        paths = [BRAINS_ROOT / brain_id]
        if AVATARS_ROOT.exists():
            for av in AVATARS_ROOT.iterdir():
                if av.is_dir():
                    p = av / "brains" / brain_id
                    if p.exists():
                        paths.append(p)
        return paths

    def _write_brain_yaml(self, brain: Brain) -> None:
        root = Path(brain.storage_root)
        root.mkdir(parents=True, exist_ok=True)
        path = root / "brain.yaml"
        path.write_text(yaml.safe_dump(brain.to_dict(), allow_unicode=True, sort_keys=False), encoding="utf-8")

    def _load_brain_from_path(self, yaml_path: Path) -> Optional[Brain]:
        if not yaml_path.exists():
            return None
        try:
            raw = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
            if not isinstance(raw, dict):
                return None
            return Brain.from_dict(raw)
        except Exception as exc:
            logger.warning("brain load failed %s: %s", yaml_path, exc)
            return None

    def get(self, brain_id: str) -> Optional[Brain]:
        for root in self._iter_brain_paths(brain_id):
            b = self._load_brain_from_path(root / "brain.yaml")
            if b is not None:
                return b
        return None

    def list_brains(self, *, include_disabled: bool = True) -> List[Brain]:
        self.bootstrap()
        out: List[Brain] = []
        seen: set[str] = set()
        for bid in self._read_registry_ids():
            if bid in seen:
                continue
            b = self.get(bid)
            if b is None:
                continue
            seen.add(bid)
            if include_disabled or b.enabled:
                out.append(b)
        # Private brains may not be in registry.json until we add registry scan
        if AVATARS_ROOT.exists():
            for av in AVATARS_ROOT.iterdir():
                brains_dir = av / "brains"
                if not brains_dir.is_dir():
                    continue
                for child in brains_dir.iterdir():
                    if not child.is_dir() or child.name in seen:
                        continue
                    b = self._load_brain_from_path(child / "brain.yaml")
                    if b is None:
                        continue
                    seen.add(b.id)
                    if include_disabled or b.enabled:
                        out.append(b)
        out.sort(key=lambda x: (x.scope.value != "global", x.name))
        return out

    def _storage_root_for(self, scope: BrainScope, owner_avatar_id: Optional[str], brain_id: str) -> Path:
        if scope == BrainScope.GLOBAL:
            return BRAINS_ROOT / brain_id
        if not owner_avatar_id:
            raise BrainError("owner_avatar_id required for private brain")
        return AVATARS_ROOT / owner_avatar_id / "brains" / brain_id

    def create(
        self,
        *,
        name: str,
        brain_type: BrainType,
        scope: BrainScope = BrainScope.GLOBAL,
        owner_avatar_id: Optional[str] = None,
        description: str = "",
        enabled: bool = True,
        config: Optional[Dict[str, Any]] = None,
    ) -> Brain:
        self.bootstrap()
        brain_id = new_brain_id()
        storage = self._storage_root_for(scope, owner_avatar_id, brain_id)
        if storage.exists():
            raise BrainError(f"storage already exists: {storage}")

        if brain_type == BrainType.DOCS:
            cfg = KBConfig.from_dict(config)
            vs_path = storage / "chroma"
            vs_path.mkdir(parents=True, exist_ok=True)
            cfg.vector_store.path = str(vs_path)
            cfg_dict = cfg.to_dict()
            (storage / "kb_data").mkdir(parents=True, exist_ok=True)
        else:
            cfg_obj = CodeBrainConfig.from_dict(config)
            cfg_dict = cfg_obj.to_dict()

        now = utc_now_iso()
        brain = Brain(
            id=brain_id,
            name=name.strip() or brain_id,
            type=brain_type,
            scope=scope,
            storage_root=str(storage),
            enabled=enabled,
            description=description,
            owner_avatar_id=owner_avatar_id if scope == BrainScope.PRIVATE else None,
            config=cfg_dict,
            stats=BrainStats(),
            created_at=now,
            updated_at=now,
        )
        with self._data_lock:
            storage.mkdir(parents=True, exist_ok=True)
            self._write_brain_yaml(brain)
            if scope == BrainScope.GLOBAL:
                ids = self._read_registry_ids()
                if brain_id not in ids:
                    ids.append(brain_id)
                    self._write_registry(ids)
        return brain

    def _validate_private_owner(self, owner_avatar_id: Optional[str]) -> str:
        owner = str(owner_avatar_id or "").strip()
        if not owner:
            raise BrainError("owner_avatar_id required for private brain")
        try:
            from agenticx.avatar.registry import AvatarRegistry

            if AvatarRegistry().get_avatar(owner) is None:
                raise BrainError(f"unknown avatar_id: {owner}")
        except BrainError:
            raise
        except Exception as exc:
            raise BrainError(f"avatar lookup failed: {exc}") from exc
        return owner

    def relocate_visibility(
        self,
        brain_id: str,
        *,
        scope: BrainScope,
        owner_avatar_id: Optional[str] = None,
    ) -> Brain:
        """Move brain storage and update registry when scope / owner changes."""
        if brain_id == DEFAULT_DOCS_BRAIN_ID:
            raise BrainError("cannot change visibility of default docs brain")
        brain = self.get(brain_id)
        if brain is None:
            raise BrainError(f"unknown brain_id: {brain_id}")

        new_owner: Optional[str] = None
        if scope == BrainScope.PRIVATE:
            new_owner = self._validate_private_owner(owner_avatar_id)
        elif owner_avatar_id:
            new_owner = None

        if brain.scope == scope and brain.owner_avatar_id == new_owner:
            brain.updated_at = utc_now_iso()
            with self._data_lock:
                self._write_brain_yaml(brain)
            return brain

        old_root = Path(brain.storage_root).resolve()
        new_root = self._storage_root_for(scope, new_owner, brain_id).resolve()
        if old_root != new_root:
            if new_root.exists():
                raise BrainError(f"target storage already exists: {new_root}")
            new_root.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(old_root), str(new_root))
            try:
                old_root.parent.rmdir()
            except OSError:
                pass

        brain.scope = scope
        brain.owner_avatar_id = new_owner
        brain.storage_root = str(new_root)
        if brain.type == BrainType.DOCS:
            cfg = KBConfig.from_dict(brain.config)
            cfg.vector_store.path = str(new_root / "chroma")
            brain.config = cfg.to_dict()

        with self._data_lock:
            ids = self._read_registry_ids()
            if scope == BrainScope.GLOBAL:
                if brain_id not in ids:
                    ids.append(brain_id)
                    self._write_registry(ids)
            elif brain_id in ids:
                self._write_registry([i for i in ids if i != brain_id])
            brain.updated_at = utc_now_iso()
            self._write_brain_yaml(brain)
        return brain

    def update(self, brain_id: str, patch: Dict[str, Any]) -> Brain:
        brain = self.get(brain_id)
        if brain is None:
            raise BrainError(f"unknown brain_id: {brain_id}")
        if "scope" in patch or "owner_avatar_id" in patch:
            scope_raw = str(patch.get("scope") or brain.scope.value)
            try:
                new_scope = BrainScope(scope_raw)
            except ValueError as exc:
                raise BrainError(f"invalid scope: {scope_raw}") from exc
            owner = patch.get("owner_avatar_id", brain.owner_avatar_id)
            return self.relocate_visibility(
                brain_id,
                scope=new_scope,
                owner_avatar_id=str(owner) if owner else None,
            )

        immutable = {"id", "type", "scope", "storage_root", "owner_avatar_id", "created_at"}
        for key, value in patch.items():
            if key in immutable:
                continue
            if key == "name" and value is not None:
                brain.name = str(value).strip() or brain.name
            elif key == "description":
                brain.description = str(value or "")
            elif key == "enabled":
                brain.enabled = bool(value)
            elif key == "config" and isinstance(value, dict):
                if brain.type == BrainType.DOCS:
                    merged = {**brain.config, **value}
                    brain.config = KBConfig.from_dict(merged).to_dict()
                else:
                    merged = {**brain.config, **value}
                    brain.config = CodeBrainConfig.from_dict(merged).to_dict()
            elif key == "stats" and isinstance(value, dict):
                brain.stats = BrainStats.from_dict({**brain.stats.to_dict(), **value})
        brain.updated_at = utc_now_iso()
        with self._data_lock:
            self._write_brain_yaml(brain)
        return brain

    def delete(self, brain_id: str) -> bool:
        brain = self.get(brain_id)
        if brain is None:
            return False
        if brain_id == DEFAULT_DOCS_BRAIN_ID:
            raise BrainError("cannot delete default docs brain")
        root = Path(brain.storage_root)
        with self._data_lock:
            if root.exists():
                shutil.rmtree(root, ignore_errors=True)
            if brain.scope == BrainScope.GLOBAL:
                ids = [i for i in self._read_registry_ids() if i != brain_id]
                self._write_registry(ids)
        self._strip_brain_from_avatars(brain_id)
        return True

    def delete_private_brains_for_avatar(self, avatar_id: str) -> None:
        brains_dir = AVATARS_ROOT / avatar_id / "brains"
        if not brains_dir.exists():
            return
        with self._data_lock:
            shutil.rmtree(brains_dir, ignore_errors=True)

    def _strip_brain_from_avatars(self, brain_id: str) -> None:
        try:
            from agenticx.avatar.registry import AvatarRegistry

            reg = AvatarRegistry()
            for av in reg.list_avatars():
                spec = getattr(av, "brains_enabled", None)
                if spec == "*" or spec is None:
                    continue
                if isinstance(spec, list) and brain_id in spec:
                    new_list = [x for x in spec if x != brain_id]
                    reg.update_avatar(av.id, {"brains_enabled": new_list or None})
        except Exception as exc:
            logger.warning("strip brain from avatars failed: %s", exc)

    def default_docs_brain_id(self) -> str:
        self.bootstrap()
        return DEFAULT_DOCS_BRAIN_ID

    def kb_registry_dir_for(self, brain: Brain) -> Path:
        """Document registry directory for a docs brain."""
        if brain.id == DEFAULT_DOCS_BRAIN_ID:
            return LEGACY_KB_REGISTRY
        return Path(brain.storage_root) / "kb_data"
