#!/usr/bin/env python3
"""Atomic file write helpers.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import tempfile
from contextlib import suppress
from pathlib import Path
from typing import Any


def atomic_write_text(path: str | Path, content: str, encoding: str = "utf-8") -> None:
    """Write text atomically via temp file + os.replace."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(target.parent), suffix=".agx.tmp")
    try:
        with os.fdopen(fd, "w", encoding=encoding) as handle:
            handle.write(content)
        os.replace(tmp_path, target)
    except Exception:
        with suppress(Exception):
            os.unlink(tmp_path)
        raise


def atomic_write_json(path: str | Path, obj: Any, *, indent: int = 2) -> None:
    """Serialize and write JSON atomically."""
    payload = json.dumps(obj, ensure_ascii=False, indent=indent)
    atomic_write_text(path, payload)
