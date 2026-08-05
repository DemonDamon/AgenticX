"""Read/write automation tasks — shared with Desktop AutomationScheduler.

This module provides the Python-side bridge so that ``schedule_task`` and
related meta tools can persist automation tasks to the same store that the
Electron main process reads every 30 s in its ``AutomationScheduler.tick()``.

Persistence is delegated to the session storage backend
(``agenticx.studio.storage``): the default local backend keeps the legacy
``~/.agenticx/automation_tasks.json`` file byte-identical; the redis backend
shares tasks across replicas.

Workspace convention (must match Desktop ``save-automation-task``):
  - If ``workspace`` is set on the task → that directory is the task root (venv
    at ``<root>/.venv``, scripts under that tree).
  - If omitted → default ``~/.agenticx/crontask/<task_id>/`` (one folder per task).
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any, Dict, List

from agenticx.studio.storage.factory import get_sync_storage

logger = logging.getLogger(__name__)

# Local-mode file locations (used by the default LocalFileBackend).
_CONFIG_DIR = Path.home() / ".agenticx"
_TASKS_PATH = _CONFIG_DIR / "automation_tasks.json"


def generate_task_id() -> str:
    ts = int(time.time() * 1000)
    import random
    suffix = "".join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=6))
    return f"atask_{ts:x}_{suffix}"


def load_automation_tasks() -> List[Dict[str, Any]]:
    """Load tasks via the session storage backend (local file by default)."""
    return get_sync_storage().load_automation_tasks()


def save_automation_tasks(tasks: List[Dict[str, Any]]) -> None:
    """Persist tasks via the session storage backend (local file by default)."""
    get_sync_storage().save_automation_tasks(tasks)
