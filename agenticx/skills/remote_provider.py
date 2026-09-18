#!/usr/bin/env python3
"""RemoteSkillProvider — pull skills from an MCP server with reading-point verification.

Implements the host side of the spec's "Integrity and Verification" rules:

- Retain the manifest while acting on a skill (:meth:`retain` / :meth:`release`).
- Restrict file reads to URIs inside the retained manifest.
- Verify each file's digest + size on every read; on mismatch reject the content,
  refresh the entry, and flag the change (which revokes approvals bound to the
  old digest set).
- Cache verified bytes on demand under
  ``~/.agenticx/skills/cache/<server_id>/<skill_name>/`` with immutable files
  (read-only chmod) that are still re-verified on every access.

Author: Damon Li
"""

from __future__ import annotations

import base64
import logging
import os
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.skills.manifest import (
    SkillIntegrityError,
    SkillManifest,
    SkillNotFoundError,
    compute_digest,
    parse_frontmatter_from_markdown,
    skill_name_from_uri,
    verify_file,
    verify_frontmatter,
)

logger = logging.getLogger(__name__)

# Default cache root; MUST stay excluded from filesystem skill discovery
# (see agenticx.tools.skill_bundle.SKILL_DISCOVERY_EXCLUDED_DIRS).
DEFAULT_SKILL_CACHE_ROOT = Path.home() / ".agenticx" / "skills" / "cache"

_SAFE_SEGMENT = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_segment(name: str) -> str:
    cleaned = _SAFE_SEGMENT.sub("_", name).strip("._") or "unnamed"
    return cleaned[:120]


@dataclass
class RemoteSkillFile:
    """One verified file read from a remote skill."""

    uri: str
    content: bytes
    mime_type: Optional[str] = None

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")


@dataclass
class SkillRefresh:
    """Outcome of re-fetching a manifest after a verification failure."""

    uri: str
    old_manifest: Optional[SkillManifest]
    new_manifest: Optional[SkillManifest]
    changed: bool

    def digest_changes(self) -> Dict[str, Optional[str]]:
        old_map = self.old_manifest.digest_map() if self.old_manifest else {}
        new_map = self.new_manifest.digest_map() if self.new_manifest else {}
        changes: Dict[str, Optional[str]] = {}
        for uri in sorted(set(old_map) | set(new_map)):
            if old_map.get(uri) != new_map.get(uri):
                changes[uri] = new_map.get(uri)
        return changes


class RemoteSkillProvider:
    """Fetch, verify, and cache skills served by one MCP server."""

    def __init__(
        self,
        client: Any,
        server_id: str,
        *,
        cache_root: Optional[Path] = None,
    ) -> None:
        self.client = client
        self.server_id = server_id
        self.cache_root = Path(cache_root) if cache_root else DEFAULT_SKILL_CACHE_ROOT
        # uri -> retained manifest ("acting on a skill" window)
        self._retained: Dict[str, SkillManifest] = {}

    # ------------------------------------------------------------------ lookup

    @property
    def server_id(self) -> str:
        return self._server_id

    @server_id.setter
    def server_id(self, value: str) -> None:
        self._server_id = str(value)

    async def list_skills(self) -> List[SkillManifest]:
        """Enumerate all skills from the server (delegates to the client)."""
        return await self.client.list_skills()

    async def get_skill(self, uri: str) -> SkillManifest:
        """Fetch one skill entry (no retention)."""
        return await self.client.get_skill(uri)

    # ------------------------------------------------------ retain / release

    async def retain(self, uri: str) -> SkillManifest:
        """Load and hold a manifest while acting on the skill."""
        manifest = await self.get_skill(uri)
        self._retained[uri] = manifest
        return manifest

    def release(self, uri: str) -> None:
        self._retained.pop(uri, None)

    def retained(self, uri: str) -> Optional[SkillManifest]:
        return self._retained.get(uri)

    def release_all(self) -> None:
        self._retained.clear()

    # ------------------------------------------------------------- read files

    async def read_file(
        self,
        file_uri: str,
        *,
        manifest: Optional[SkillManifest] = None,
    ) -> RemoteSkillFile:
        """
        Read one file of a retained skill, verifying it at the reading point.

        Reads are restricted to URIs inside the retained manifest (or the
        manifest passed explicitly). Every read re-verifies digest + size; on
        mismatch the content is rejected, the entry is refreshed, and the
        mismatch is reported for approval revocation.
        """
        owner = self._resolve_manifest(file_uri, manifest)
        if owner is None:
            raise SkillIntegrityError(
                file_uri,
                "URI is outside any retained skill manifest "
                "(read the SKILL.md entry first via retain()/get_skill())",
            )

        entry = owner.find_file(file_uri) if not owner.is_dynamic else None
        if entry is None and not owner.is_dynamic:
            raise SkillIntegrityError(
                file_uri,
                f"URI not part of the manifest for skill {owner.uri!r}",
            )

        # Cache hit path — still verify bytes on every access.
        cached = self._cache_path_for(owner, file_uri)
        if cached is not None and cached.exists():
            try:
                raw = cached.read_bytes()
            except OSError:
                raw = None
            if raw is not None:
                if entry is None or verify_file(entry, raw) is None:
                    self._verify_skill_md_frontmatter(owner, file_uri, raw)
                    return RemoteSkillFile(uri=file_uri, content=raw)

        raw, mime = await self._fetch_resource(file_uri)
        if entry is not None:
            error = verify_file(entry, raw)
            if error is not None:
                # Reject content, refresh entry, report for approval revocation.
                refresh = await self.refresh(owner.uri)
                logger.warning(
                    "Skill file verification failed (%s); refreshed manifest "
                    "(changed=%s): %s",
                    error,
                    refresh.changed,
                    sorted(refresh.digest_changes()),
                )
                raise SkillIntegrityError(
                    file_uri,
                    f"{error.reason}; manifest refreshed, approval may need to be "
                    "re-granted",
                ) from error
        self._verify_skill_md_frontmatter(owner, file_uri, raw)
        self._write_cache(cached, raw)
        return RemoteSkillFile(uri=file_uri, content=raw, mime_type=mime)

    def _resolve_manifest(
        self, file_uri: str, explicit: Optional[SkillManifest]
    ) -> Optional[SkillManifest]:
        if explicit is not None:
            return explicit
        for manifest in self._retained.values():
            if manifest.is_dynamic:
                if self._uri_under_dynamic_root(manifest, file_uri):
                    return manifest
            elif manifest.find_file(file_uri) is not None:
                return manifest
        return None

    @staticmethod
    def _uri_under_dynamic_root(manifest: SkillManifest, file_uri: str) -> bool:
        root = manifest.uri
        if root.endswith("/SKILL.md"):
            root = root[: -len("/SKILL.md")]
        return file_uri.startswith(root + "/") or file_uri == root + "/SKILL.md"

    def _verify_skill_md_frontmatter(
        self, manifest: SkillManifest, file_uri: str, raw: bytes
    ) -> None:
        if not file_uri.endswith("SKILL.md"):
            return
        parsed = parse_frontmatter_from_markdown(raw.decode("utf-8", errors="replace"))
        error = verify_frontmatter(manifest, parsed)
        if error is not None:
            raise error

    async def _fetch_resource(self, file_uri: str) -> tuple[bytes, Optional[str]]:
        result = await self.client.read_resource(file_uri)
        contents = getattr(result, "contents", None) or []
        if not contents:
            raise SkillIntegrityError(file_uri, "resources/read returned no contents")
        block = contents[0]
        text = getattr(block, "text", None)
        if isinstance(text, str):
            return text.encode("utf-8"), getattr(block, "mimeType", None)
        blob = getattr(block, "blob", None)
        if isinstance(blob, str):
            return base64.b64decode(blob), getattr(block, "mimeType", None)
        raise SkillIntegrityError(file_uri, "resource content is neither text nor blob")

    # ---------------------------------------------------------------- refresh

    async def refresh(self, uri: str) -> SkillRefresh:
        """Re-fetch a manifest and diff the digest set against the retained one."""
        old = self._retained.get(uri)
        try:
            new = await self.get_skill(uri)
        except SkillNotFoundError:
            self._retained.pop(uri, None)
            return SkillRefresh(uri=uri, old_manifest=old, new_manifest=None, changed=True)
        self._retained[uri] = new
        old_map = old.digest_map() if old else {}
        new_map = new.digest_map()
        changed = old_map != new_map
        if changed:
            logger.info(
                "Manifest for %s changed on refresh (approvals bound to the old "
                "digest set are revoked)",
                uri,
            )
        return SkillRefresh(uri=uri, old_manifest=old, new_manifest=new, changed=changed)

    # ------------------------------------------------------------------ cache

    def cache_dir_for(self, manifest: SkillManifest) -> Path:
        """Cache dir encodes server identity + skill name (spec requirement)."""
        name = _safe_segment(manifest.name or skill_name_from_uri(manifest.uri))
        return self.cache_root / _safe_segment(self.server_id) / name

    def _cache_path_for(self, manifest: SkillManifest, file_uri: str) -> Optional[Path]:
        root = self.cache_dir_for(manifest)
        if manifest.is_dynamic:
            relative = self._relative_to_skill_root(manifest.uri, file_uri)
        else:
            entry = manifest.find_file(file_uri)
            if entry is None:
                return None
            relative = self._relative_to_skill_root(manifest.uri, file_uri)
        if relative is None:
            return None
        target = (root / relative).resolve()
        try:
            target.relative_to(root.resolve())
        except ValueError:
            return None
        return target

    @staticmethod
    def _relative_to_skill_root(skill_md_uri: str, file_uri: str) -> Optional[str]:
        root = skill_md_uri
        if root.endswith("/SKILL.md"):
            root = root[: -len("/SKILL.md")]
        if not file_uri.startswith(root + "/"):
            return None
        return file_uri[len(root) + 1:]

    def _write_cache(self, path: Optional[Path], raw: bytes) -> None:
        if path is None:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists():
                # Immutable cache: verify; rewrite only if bytes drifted.
                if path.read_bytes() == raw:
                    return
                os.chmod(path, 0o644)
            with tempfile.NamedTemporaryFile(
                mode="wb", dir=str(path.parent), delete=False, prefix=".tmp-"
            ) as handle:
                handle.write(raw)
                tmp = Path(handle.name)
            os.replace(tmp, path)
            os.chmod(path, 0o444)  # read-only: model/tools must not mutate
        except OSError as exc:
            logger.debug("Skill cache write skipped for %s: %s", path, exc)

    def clear_cache(self) -> None:
        """Drop cached bytes for this server (debug / re-download)."""
        import shutil

        server_root = self.cache_root / _safe_segment(self.server_id)
        if server_root.exists():
            shutil.rmtree(server_root, ignore_errors=True)
