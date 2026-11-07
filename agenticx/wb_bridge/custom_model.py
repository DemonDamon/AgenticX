#!/usr/bin/env python3
"""Rewrite catalog model ids that collide with a custom models.json endpoint.

The CLI prefers a builtin id over a same-named custom entry unless the flag
is ``custom-local:<id>``. This module only checks that an entry has a non-empty
``url`` and ``apiKey``; it never returns or logs the key.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

CUSTOM_LOCAL_PREFIX = "custom-local:"


def codebuddy_model_config_paths(home: Optional[Path] = None) -> list[Path]:
    """User-level model catalogs for both config homes."""
    root = home if home is not None else Path.home()
    return [
        root / ".codebuddy" / "models.json",
        root / ".workbuddy" / "models.json",
    ]


def resolve_codebuddy_cli_model(
    model_id: Optional[str],
    *,
    config_paths: Optional[Sequence[Path]] = None,
) -> Optional[str]:
    """Return the ``--model`` value to pass to the CLI.

    ``custom-local:`` prefixes are preserved. A bare id is prefixed only when
    some config file has a matching entry with both ``url`` and ``apiKey``.
    Missing files, malformed JSON, and unmatched ids are a no-op.
    """
    raw = str(model_id or "").strip()
    if not raw:
        return None
    if raw.startswith(CUSTOM_LOCAL_PREFIX):
        return raw
    paths = list(config_paths) if config_paths is not None else codebuddy_model_config_paths()
    if _id_has_custom_endpoint(raw, paths):
        return f"{CUSTOM_LOCAL_PREFIX}{raw}"
    return raw


def _id_has_custom_endpoint(model_id: str, paths: Sequence[Path]) -> bool:
    for path in paths:
        for entry in _load_model_entries(path):
            entry_id = str(entry.get("id") or "").strip()
            if entry_id != model_id:
                continue
            if _entry_has_endpoint(entry):
                return True
    return False


def _entry_has_endpoint(entry: dict[str, Any]) -> bool:
    url = str(entry.get("url") or "").strip()
    api_key = str(entry.get("apiKey") or "").strip()
    return bool(url and api_key)


def _load_model_entries(path: Path) -> Iterable[dict[str, Any]]:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return ()
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return ()
    if not isinstance(payload, dict):
        return ()
    models = payload.get("models")
    if not isinstance(models, list):
        return ()
    return tuple(item for item in models if isinstance(item, dict))


__all__ = [
    "CUSTOM_LOCAL_PREFIX",
    "codebuddy_model_config_paths",
    "resolve_codebuddy_cli_model",
]
