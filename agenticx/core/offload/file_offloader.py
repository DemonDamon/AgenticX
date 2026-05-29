#!/usr/bin/env python3
"""Filesystem-backed offloader.

Persists offloaded payloads to ``<root>/<session_id>/<handle>.json`` so they
survive process restarts and can be retrieved by handle. This is the default
``Offloader`` implementation; a KB-backed variant can follow the same protocol.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Sequence

from agenticx.core.offload.protocol import (
    OffloadError,
    Reference,
    compute_handle,
    stringify_messages,
    stringify_tool_result,
)

_log = logging.getLogger(__name__)

_DEFAULT_ROOT = os.path.expanduser("~/.agenticx/offload")


def _summarize(text: str, limit: int = 200) -> str:
    """Build a short single-line summary of a payload for the placeholder."""
    head = text.strip().replace("\r", " ").replace("\n", " ")
    if len(head) > limit:
        return head[:limit] + "..."
    return head


class FileOffloader:
    """Store offloaded content on local disk and retrieve it by handle."""

    def __init__(self, root: str | os.PathLike[str] | None = None) -> None:
        """Create a file offloader.

        Args:
            root: Storage root. Defaults to ``~/.agenticx/offload``. ``~`` and
                environment variables are expanded.
        """
        raw = str(root) if root is not None else _DEFAULT_ROOT
        self.root = Path(os.path.expanduser(os.path.expandvars(raw)))

    def _session_dir(self, session_id: str) -> Path:
        safe = session_id.strip() or "default"
        # Guard against path traversal in session ids.
        safe = safe.replace("/", "_").replace("\\", "_").replace("..", "_")
        return self.root / safe

    def _record_path(self, session_id: str, handle: str) -> Path:
        return self._session_dir(session_id) / f"{handle}.json"

    def _write(
        self,
        session_id: str,
        payload: str,
        *,
        kind: str,
        tool_name: str,
        content_type: str,
    ) -> Reference:
        handle = compute_handle(payload)
        reference = Reference(
            handle=handle,
            size=len(payload.encode("utf-8")),
            kind=kind,
            session_id=session_id,
            summary=_summarize(payload),
            content_type=content_type,
            tool_name=tool_name,
        )
        record: Dict[str, Any] = {
            "reference": reference.to_dict(),
            "payload": payload,
        }
        path = self._record_path(session_id, handle)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(
                json.dumps(record, ensure_ascii=False),
                encoding="utf-8",
            )
            os.replace(tmp, path)
        except OSError as exc:
            raise OffloadError(
                f"failed to write offload record {handle!r}: {exc}",
            ) from exc
        _log.debug(
            "offloaded kind=%s session=%s handle=%s bytes=%d",
            kind,
            session_id,
            handle,
            reference.size,
        )
        return reference

    async def offload_context(
        self,
        session_id: str,
        msgs: Sequence[Dict[str, Any]],
    ) -> Reference:
        """Offload a compressed context block."""
        payload = stringify_messages(msgs)
        return await asyncio.to_thread(
            self._write,
            session_id,
            payload,
            kind="context",
            tool_name="",
            content_type="text/plain",
        )

    async def offload_tool_result(
        self,
        session_id: str,
        tool_result: Any,
        *,
        tool_name: str = "",
    ) -> Reference:
        """Offload a single tool result."""
        payload = stringify_tool_result(tool_result)
        return await asyncio.to_thread(
            self._write,
            session_id,
            payload,
            kind="tool_result",
            tool_name=tool_name,
            content_type="text/plain",
        )

    def _read(self, reference: Reference) -> str:
        path = self._record_path(reference.session_id, reference.handle)
        if not path.exists():
            raise OffloadError(
                f"offload reference not found: handle={reference.handle!r} "
                f"session={reference.session_id!r}",
            )
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise OffloadError(
                f"failed to read offload record {reference.handle!r}: {exc}",
            ) from exc
        return str(record.get("payload", ""))

    async def retrieve(self, reference: Reference) -> str:
        """Retrieve the full payload behind a reference.

        Raises:
            OffloadError: If the reference cannot be resolved or read.
        """
        return await asyncio.to_thread(self._read, reference)
