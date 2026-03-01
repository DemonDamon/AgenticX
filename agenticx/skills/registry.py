#!/usr/bin/env python3
"""Skill registry client/server for AgenticX.

This module provides a minimal remote skill registry:
- JSON-backed storage with atomic writes
- FastAPI server endpoints for publish/list/detail/delete
- Client helpers for publish/search/install/uninstall

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import yaml  # type: ignore[import-untyped]
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compute_sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


_SKILL_NAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


def _validate_skill_name(name: str) -> str:
    if not _SKILL_NAME_PATTERN.match(name):
        raise ValueError(
            "Invalid skill name. Use only letters, numbers, dot, underscore, hyphen."
        )
    return name


def _extract_frontmatter(skill_content: str) -> Dict[str, Any]:
    stripped = skill_content.strip()
    if not stripped.startswith("---"):
        return {}
    lines = skill_content.splitlines()
    if not lines:
        return {}
    if lines[0].strip() != "---":
        return {}
    end_idx: Optional[int] = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return {}
    block = "\n".join(lines[1:end_idx])
    try:
        parsed = yaml.safe_load(block) or {}
        if isinstance(parsed, dict):
            return parsed
    except Exception as exc:
        logger.warning("Failed to parse SKILL.md frontmatter: %s", exc)
    return {}


@dataclass
class RegistrySkillEntry:
    """Serializable skill entry stored in registry."""

    name: str
    version: str
    description: str
    gate: Dict[str, Any] = field(default_factory=dict)
    author: str = "unknown"
    created_at: str = field(default_factory=_now_iso)
    checksum: str = ""
    skill_content: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "gate": self.gate,
            "author": self.author,
            "created_at": self.created_at,
            "checksum": self.checksum,
            "skill_content": self.skill_content,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RegistrySkillEntry":
        return cls(
            name=str(data.get("name", "")),
            version=str(data.get("version", "0.1.0")),
            description=str(data.get("description", "")),
            gate=dict(data.get("gate", {}) or {}),
            author=str(data.get("author", "unknown")),
            created_at=str(data.get("created_at", _now_iso())),
            checksum=str(data.get("checksum", "")),
            skill_content=str(data.get("skill_content", "")),
        )


class RegistryStorage:
    """JSON storage for skill entries with atomic write semantics."""

    def __init__(self, storage_path: Optional[Path] = None) -> None:
        self.storage_path = storage_path or (Path.home() / ".agenticx" / "registry.json")
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def _load(self) -> Dict[str, Any]:
        if not self.storage_path.exists():
            return {"skills": {}}
        try:
            raw = json.loads(self.storage_path.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and isinstance(raw.get("skills"), dict):
                return raw
        except Exception as exc:
            logger.warning("Failed to read registry file %s: %s", self.storage_path, exc)
        return {"skills": {}}

    def _save(self, data: Dict[str, Any]) -> None:
        encoded = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            delete=False,
            dir=str(self.storage_path.parent),
            prefix=f"{self.storage_path.name}.tmp.",
        ) as handle:
            handle.write(encoded)
            tmp_path = Path(handle.name)
        os.replace(tmp_path, self.storage_path)

    def list_entries(self, query: str = "") -> List[RegistrySkillEntry]:
        with self._lock:
            payload = self._load()
            skills_obj = payload.get("skills", {})
            items: List[RegistrySkillEntry] = []
            q = query.strip().lower()
            for versions in skills_obj.values():
                if not isinstance(versions, list):
                    continue
                for row in versions:
                    if not isinstance(row, dict):
                        continue
                    entry = RegistrySkillEntry.from_dict(row)
                    if q and q not in entry.name.lower() and q not in entry.description.lower():
                        continue
                    items.append(entry)
            items.sort(key=lambda x: (x.name, x.version, x.created_at))
            return items

    def get_latest(self, name: str) -> Optional[RegistrySkillEntry]:
        with self._lock:
            payload = self._load()
            versions = payload.get("skills", {}).get(name, [])
            if not isinstance(versions, list) or not versions:
                return None
            entries = [RegistrySkillEntry.from_dict(v) for v in versions if isinstance(v, dict)]
            if not entries:
                return None
            entries.sort(key=lambda x: (x.created_at, x.version))
            return entries[-1]

    def publish(self, entry: RegistrySkillEntry) -> RegistrySkillEntry:
        with self._lock:
            payload = self._load()
            skills_obj = payload.setdefault("skills", {})
            if not isinstance(skills_obj, dict):
                payload["skills"] = {}
                skills_obj = payload["skills"]
            versions = skills_obj.setdefault(entry.name, [])
            if not isinstance(versions, list):
                versions = []
                skills_obj[entry.name] = versions
            for row in versions:
                if isinstance(row, dict) and str(row.get("version", "")) == entry.version:
                    raise ValueError(
                        f"Skill '{entry.name}' version '{entry.version}' already exists"
                    )
            versions.append(entry.to_dict())
            self._save(payload)
            return entry

    def delete(self, name: str, version: str) -> bool:
        with self._lock:
            payload = self._load()
            skills_obj = payload.get("skills", {})
            if not isinstance(skills_obj, dict) or name not in skills_obj:
                return False
            versions = skills_obj.get(name, [])
            if not isinstance(versions, list):
                return False
            original_len = len(versions)
            filtered = [
                v
                for v in versions
                if not (isinstance(v, dict) and str(v.get("version", "")) == version)
            ]
            if len(filtered) == original_len:
                return False
            if filtered:
                skills_obj[name] = filtered
            else:
                skills_obj.pop(name, None)
            self._save(payload)
            return True


class RegistrySkillEntryModel(BaseModel):
    name: str = Field(min_length=1)
    version: str = Field(default="0.1.0", min_length=1)
    description: str = Field(default="")
    gate: Dict[str, Any] = Field(default_factory=dict)
    author: str = Field(default="unknown")
    created_at: str = Field(default_factory=_now_iso)
    checksum: str = Field(default="")
    skill_content: str = Field(default="")

    def to_entry(self) -> RegistrySkillEntry:
        return RegistrySkillEntry(
            name=self.name,
            version=self.version,
            description=self.description,
            gate=self.gate,
            author=self.author,
            created_at=self.created_at,
            checksum=self.checksum,
            skill_content=self.skill_content,
        )


class SkillRegistryServer:
    """Registry HTTP server exposing publish/list/detail/delete APIs."""

    def __init__(
        self,
        storage_path: Optional[Path] = None,
        host: str = "127.0.0.1",
        port: int = 8321,
        write_token: Optional[str] = None,
    ) -> None:
        self.host = host
        self.port = port
        self.write_token = write_token or os.environ.get("AGENTICX_SKILL_REGISTRY_TOKEN")
        self.storage = RegistryStorage(storage_path=storage_path)

    def create_app(self) -> FastAPI:
        app = FastAPI(title="AgenticX Skill Registry", version="0.1.0")
        storage = self.storage

        @app.post("/skills")
        def publish_skill(
            payload: RegistrySkillEntryModel,
            authorization: Optional[str] = Header(default=None),
            x_registry_token: Optional[str] = Header(default=None),
        ) -> Dict[str, Any]:
            if self.write_token:
                provided = x_registry_token
                if not provided and authorization and authorization.lower().startswith("bearer "):
                    provided = authorization[7:]
                if provided != self.write_token:
                    raise HTTPException(status_code=401, detail="Unauthorized publish attempt")
            entry = payload.to_entry()
            _validate_skill_name(entry.name)
            if not entry.checksum:
                entry.checksum = _compute_sha256(entry.skill_content)
            try:
                stored = storage.publish(entry)
                return {"ok": True, "entry": stored.to_dict()}
            except ValueError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc

        @app.get("/skills")
        def list_skills(q: str = "") -> Dict[str, Any]:
            rows = storage.list_entries(query=q)
            return {"ok": True, "items": [item.to_dict() for item in rows], "count": len(rows)}

        @app.get("/skills/{name}")
        def get_skill(name: str) -> Dict[str, Any]:
            found = storage.get_latest(name)
            if found is None:
                raise HTTPException(status_code=404, detail=f"Skill '{name}' not found")
            return {"ok": True, "entry": found.to_dict()}

        @app.delete("/skills/{name}/{version}")
        def delete_skill(
            name: str,
            version: str,
            authorization: Optional[str] = Header(default=None),
            x_registry_token: Optional[str] = Header(default=None),
        ) -> Dict[str, Any]:
            if self.write_token:
                provided = x_registry_token
                if not provided and authorization and authorization.lower().startswith("bearer "):
                    provided = authorization[7:]
                if provided != self.write_token:
                    raise HTTPException(status_code=401, detail="Unauthorized delete attempt")
            removed = storage.delete(name, version)
            if not removed:
                raise HTTPException(
                    status_code=404,
                    detail=f"Skill '{name}' version '{version}' not found",
                )
            return {"ok": True}

        return app

    def run(self) -> None:
        import uvicorn

        uvicorn.run(self.create_app(), host=self.host, port=self.port)


class SkillRegistryClient:
    """Registry HTTP client for publish/search/install/uninstall workflow."""

    def __init__(
        self,
        registry_url: str = "http://127.0.0.1:8321",
        timeout: float = 10.0,
        write_token: Optional[str] = None,
    ) -> None:
        self.registry_url = registry_url.rstrip("/")
        self.timeout = timeout
        self.write_token = write_token

    def _url(self, path: str) -> str:
        return f"{self.registry_url}{path}"

    def _write_headers(self) -> Dict[str, str]:
        if not self.write_token:
            return {}
        return {"X-Registry-Token": self.write_token}

    def publish(self, skill_path: Path) -> RegistrySkillEntry:
        md_path = skill_path
        if skill_path.is_dir():
            md_path = skill_path / "SKILL.md"
        if not md_path.exists():
            raise FileNotFoundError(f"SKILL.md not found at {md_path}")
        skill_content = md_path.read_text(encoding="utf-8")
        frontmatter = _extract_frontmatter(skill_content)
        name = str(frontmatter.get("name", "")).strip()
        if not name:
            raise ValueError("SKILL.md frontmatter requires 'name'")
        entry = RegistrySkillEntry(
            name=name,
            version=str(frontmatter.get("version", "0.1.0")),
            description=str(frontmatter.get("description", "")),
            gate=dict(
                (
                    (frontmatter.get("metadata", {}) or {})
                    .get("agenticx", {})
                    .get("gate", {})
                )
                or {}
            ),
            author=str(frontmatter.get("author", "unknown")),
            checksum=_compute_sha256(skill_content),
            skill_content=skill_content,
        )
        payload = entry.to_dict()
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(
                self._url("/skills"),
                json=payload,
                headers=self._write_headers(),
            )
        response.raise_for_status()
        data = response.json().get("entry", {})
        return RegistrySkillEntry.from_dict(data)

    def search(self, query: str = "") -> List[RegistrySkillEntry]:
        with httpx.Client(timeout=self.timeout) as client:
            response = client.get(self._url("/skills"), params={"q": query})
        response.raise_for_status()
        items = response.json().get("items", [])
        return [RegistrySkillEntry.from_dict(i) for i in items if isinstance(i, dict)]

    def get(self, name: str) -> RegistrySkillEntry:
        with httpx.Client(timeout=self.timeout) as client:
            response = client.get(self._url(f"/skills/{name}"))
        response.raise_for_status()
        return RegistrySkillEntry.from_dict(response.json().get("entry", {}))

    def install(self, name: str, target_dir: Optional[Path] = None) -> Path:
        entry = self.get(name)
        validated_name = _validate_skill_name(entry.name)
        install_root = target_dir or (Path.home() / ".agenticx" / "skills" / "registry")
        install_root = install_root.resolve()
        skill_dir = (install_root / validated_name).resolve()
        try:
            skill_dir.relative_to(install_root)
        except ValueError as exc:
            raise ValueError("Resolved install path escapes target directory") from exc
        skill_dir.mkdir(parents=True, exist_ok=True)
        md_path = skill_dir / "SKILL.md"
        md_path.write_text(entry.skill_content, encoding="utf-8")
        return md_path

    def uninstall(self, name: str, target_dir: Optional[Path] = None) -> bool:
        validated_name = _validate_skill_name(name)
        install_root = target_dir or (Path.home() / ".agenticx" / "skills" / "registry")
        install_root = install_root.resolve()
        skill_dir = (install_root / validated_name).resolve()
        try:
            skill_dir.relative_to(install_root)
        except ValueError as exc:
            raise ValueError("Resolved uninstall path escapes target directory") from exc
        md_path = skill_dir / "SKILL.md"
        if md_path.exists():
            md_path.unlink()
        if skill_dir.exists() and skill_dir.is_dir():
            try:
                skill_dir.rmdir()
            except OSError:
                return False
            return True
        return False
