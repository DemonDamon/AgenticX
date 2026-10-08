#!/usr/bin/env python3
"""UnifiedSkillIndex — one view over local registry skills and MCP skills.

Aggregates the local ``RegistryStorage`` and one :class:`RemoteSkillProvider`
per connected MCP server. Primary key is ``{server_id}::{uri}`` (spec: skill
identity = server identity + URI; ``name`` is only a label), so same-named
skills from different origins coexist and are never silently replaced.

Remote activation goes through :meth:`UnifiedSkillIndex.read_remote_skill`:
retain manifest → read every manifest file (reading-point digest verification
+ immutable cache) → content gate (``scan_skill_deep``) → digest-bound
approval (SP1 Task 4). Reading a remote SKILL.md without activation is
available through the provider directly.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.skills.approval import (
    ActivationDecision,
    ApprovalStore,
    SkillApproval,
    check_activation,
)
from agenticx.skills.manifest import SkillManifest, SkillNotFoundError
from agenticx.skills.remote_provider import RemoteSkillProvider

logger = logging.getLogger(__name__)

LOCAL_SERVER_ID = "local"
_LOCAL_URI_PREFIX = "registry://"


@dataclass
class SkillView:
    """One skill in the unified view, tagged with its origin."""

    origin: str  # "local" | "mcp"
    server_id: str
    uri: str
    name: str
    description: str
    version: Optional[str] = None
    manifest: Optional[SkillManifest] = None

    @property
    def skill_id(self) -> str:
        return f"{self.server_id}::{self.uri}"

    @property
    def file_count(self) -> Optional[int]:
        if self.manifest is None or self.manifest.is_dynamic:
            return None if self.manifest is None else 0
        return len(self.manifest.resources or [])

    @property
    def total_bytes(self) -> Optional[int]:
        if self.manifest is None or self.manifest.is_dynamic:
            return None
        return self.manifest.total_bytes()

    def to_dict(self) -> Dict[str, Any]:
        """Display payload with the origin label (never a name replacement)."""
        payload: Dict[str, Any] = {
            "skill_id": self.skill_id,
            "origin": self.origin,
            "server_id": self.server_id,
            "uri": self.uri,
            "name": self.name,
            "description": self.description,
        }
        if self.version:
            payload["version"] = self.version
        if self.manifest is not None:
            payload["dynamic"] = self.manifest.is_dynamic
            payload["file_count"] = self.file_count
            payload["total_bytes"] = self.total_bytes
        return payload


@dataclass
class RemoteReadResult:
    """Outcome of a remote skill read via the activation gate."""

    status: str  # "ok" | "denied" | "not_found"
    content: Optional[str] = None
    reasons: List[str] = field(default_factory=list)
    decision: Optional[ActivationDecision] = None
    manifest: Optional[SkillManifest] = None


def _run_coro_sync(coro):
    """Run a coroutine from sync code, also safe inside a running loop.

    Always executes ``asyncio.run`` on a worker thread: besides being safe
    when called from inside a running loop, this keeps the main thread's
    event-loop policy untouched (``asyncio.run`` clears the thread-local
    loop, which would break any later ``asyncio.get_event_loop()`` call in
    the main thread on Python 3.12+).
    """
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


class UnifiedSkillIndex:
    """Aggregate local registry storage and remote MCP skill providers."""

    def __init__(
        self,
        registry_storage: Optional[Any] = None,
        approval_store: Optional[ApprovalStore] = None,
    ) -> None:
        self._storage = registry_storage
        self._approval_store = approval_store
        self._providers: Dict[str, RemoteSkillProvider] = {}

    # -------------------------------------------------------------- providers

    def add_provider(self, provider: RemoteSkillProvider) -> None:
        """Register (or replace) the provider for one server identity."""
        self._providers[provider.server_id] = provider

    def remove_provider(self, server_id: str) -> None:
        self._providers.pop(server_id, None)

    @property
    def provider_ids(self) -> List[str]:
        return sorted(self._providers)

    # ------------------------------------------------------------- listing

    async def list_skills(self, *, origin: Optional[str] = None) -> List[SkillView]:
        """List local + remote skills; same name from different origins coexists."""
        views: Dict[str, SkillView] = {}
        if self._storage is not None and origin in (None, "local"):
            for view in self._local_views():
                views[view.skill_id] = view
        if origin in (None, "mcp"):
            for server_id, provider in self._providers.items():
                try:
                    manifests = await provider.list_skills()
                except Exception as exc:
                    logger.warning(
                        "skills/list failed for server %s: %s", server_id, exc
                    )
                    continue
                for manifest in manifests:
                    view = SkillView(
                        origin="mcp",
                        server_id=server_id,
                        uri=manifest.uri,
                        name=manifest.name,
                        description=manifest.description,
                        manifest=manifest,
                    )
                    views[view.skill_id] = view  # same server+URI replaces
        return sorted(views.values(), key=lambda v: (v.name, v.server_id))

    def _local_views(self) -> List[SkillView]:
        from agenticx.skills.registry import RegistrySkillEntry  # local import

        storage = self._storage
        lister = getattr(storage, "list_entries", None)
        if lister is None:
            return []
        entries: List[RegistrySkillEntry] = lister()
        latest: Dict[str, RegistrySkillEntry] = {}
        for entry in entries:  # sorted by (name, version, created_at) — last wins
            latest[entry.name] = entry
        return [
            SkillView(
                origin="local",
                server_id=LOCAL_SERVER_ID,
                uri=f"{_LOCAL_URI_PREFIX}{entry.name}",
                name=entry.name,
                description=entry.description,
                version=entry.version,
            )
            for entry in sorted(latest.values(), key=lambda e: e.name)
        ]

    # ------------------------------------------------------------- lookup

    async def get(self, skill_id: str) -> Optional[SkillView]:
        server_id, _, uri = skill_id.partition("::")
        if not uri:
            return None
        if server_id == LOCAL_SERVER_ID:
            return self._get_local(uri)
        provider = self._providers.get(server_id)
        if provider is None:
            return None
        try:
            manifest = await provider.get_skill(uri)
        except SkillNotFoundError:
            return None
        except Exception as exc:
            logger.warning("skills/get failed for %s: %s", uri, exc)
            return None
        return SkillView(
            origin="mcp",
            server_id=server_id,
            uri=manifest.uri,
            name=manifest.name,
            description=manifest.description,
            manifest=manifest,
        )

    def _get_local(self, uri: str) -> Optional[SkillView]:
        if not uri.startswith(_LOCAL_URI_PREFIX):
            return None
        name = uri[len(_LOCAL_URI_PREFIX):]
        getter = getattr(self._storage, "get_latest", None)
        if getter is None:
            return None
        entry = getter(name)
        if entry is None:
            return None
        return SkillView(
            origin="local",
            server_id=LOCAL_SERVER_ID,
            uri=f"{_LOCAL_URI_PREFIX}{entry.name}",
            name=entry.name,
            description=entry.description,
            version=entry.version,
        )

    async def find_by_name(self, name: str) -> List[SkillView]:
        views = await self.list_skills()
        return [v for v in views if v.name == name]

    # ------------------------------------------------------------- activation

    async def read_remote_skill(
        self,
        name: str,
        *,
        approval_store: Optional[ApprovalStore] = None,
        require_approval: Optional[bool] = None,
        source: str = "community",
    ) -> RemoteReadResult:
        """
        Read one remote skill by name through the full activation gate:
        retain → read all manifest files (verified + cached) → content scan →
        digest-bound approval.
        """
        views = [v for v in await self.find_by_name(name) if v.origin == "mcp"]
        if not views:
            return RemoteReadResult(status="not_found")
        view = views[0]
        provider = self._providers.get(view.server_id)
        if provider is None:  # pragma: no cover — defensive
            return RemoteReadResult(status="not_found")

        manifest: Optional[SkillManifest]
        try:
            manifest = await provider.retain(view.uri)
            # Activation needs the content: materialize every manifest file
            # through the verified cache (reading-point digest checks).
            for file_uri in manifest.file_uris():
                await provider.read_file(file_uri)
        except Exception as exc:
            logger.warning("Failed to load remote skill %s: %s", view.uri, exc)
            return RemoteReadResult(status="denied", reasons=[f"load failed: {exc}"])

        skill_dir = provider.cache_dir_for(manifest)
        store = approval_store or self._approval_store or ApprovalStore()
        approval: Optional[SkillApproval] = store.get(view.server_id, manifest.uri)
        if approval is not None:
            # Auto-revoke stale records: any file added/removed/modified on the
            # server invalidates the bound digest set (spec requirement).
            store.revoke_if_invalid(view.server_id, manifest)

        decision = check_activation(
            manifest,
            skill_dir=skill_dir,
            approval=approval,
            require_approval=require_approval,
            source=source,
        )
        if not decision.allowed:
            return RemoteReadResult(
                status="denied",
                reasons=decision.reasons,
                decision=decision,
                manifest=manifest,
            )

        try:
            skill_file = await provider.read_file(view.uri)
        except Exception as exc:  # pragma: no cover — verified above
            return RemoteReadResult(status="denied", reasons=[f"read failed: {exc}"])
        return RemoteReadResult(
            status="ok",
            content=skill_file.text,
            decision=decision,
            manifest=manifest,
        )

    # ------------------------------------------------------------ sync bridges

    def list_skills_sync(self, *, origin: Optional[str] = None) -> List[SkillView]:
        return _run_coro_sync(self.list_skills(origin=origin))

    def find_by_name_sync(self, name: str) -> List[SkillView]:
        return _run_coro_sync(self.find_by_name(name))

    def read_remote_skill_sync(self, name: str, **kwargs: Any) -> RemoteReadResult:
        return _run_coro_sync(self.read_remote_skill(name, **kwargs))
