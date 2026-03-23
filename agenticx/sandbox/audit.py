#!/usr/bin/env python3
"""Sandbox audit trail — JSONL-based operation logging.

Records every sandbox operation (execute, run_command, read_file, write_file, etc.)
to append-only JSONL files with automatic rotation.

Author: Damon Li
"""

import hashlib
import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

DEFAULT_LOG_DIR = str(Path.home() / ".agenticx" / "sandbox" / "audit")
DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB


@dataclass
class AuditEntry:
    """Single audit record."""

    timestamp: float
    sandbox_id: str
    operation: str
    code_hash: str
    exit_code: int
    duration_ms: float
    backend: str = ""
    language: str = ""
    error: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @classmethod
    def from_json(cls, line: str) -> "AuditEntry":
        data = json.loads(line)
        return cls(**data)


class SandboxAuditTrail:
    """Append-only JSONL audit log with auto-rotation."""

    def __init__(
        self,
        log_dir: Optional[str] = None,
        max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    ):
        self._log_dir = Path(log_dir or DEFAULT_LOG_DIR)
        self._log_dir.mkdir(parents=True, exist_ok=True)
        self._max_file_bytes = max_file_bytes
        self._current_file: Optional[Path] = None
        self._ensure_file()

    def _ensure_file(self) -> None:
        if self._current_file and self._current_file.exists():
            if self._current_file.stat().st_size < self._max_file_bytes:
                return
        ts = time.strftime("%Y%m%d_%H%M%S")
        # Unique suffix so multiple rotations in the same second do not reuse one path.
        self._current_file = self._log_dir / f"sandbox_audit_{ts}_{time.time_ns()}.jsonl"

    def record(
        self,
        sandbox_id: str,
        operation: str,
        code: str,
        exit_code: int,
        duration_ms: float,
        backend: str = "",
        language: str = "",
        error: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> AuditEntry:
        code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()[:16]
        entry = AuditEntry(
            timestamp=time.time(),
            sandbox_id=sandbox_id,
            operation=operation,
            code_hash=code_hash,
            exit_code=exit_code,
            duration_ms=duration_ms,
            backend=backend,
            language=language,
            error=error,
            metadata=dict(metadata or {}),
        )
        self._ensure_file()
        with open(self._current_file, "a", encoding="utf-8") as f:
            f.write(entry.to_json() + "\n")
        return entry

    def query(
        self,
        sandbox_id: Optional[str] = None,
        operation: Optional[str] = None,
        limit: int = 100,
    ) -> List[AuditEntry]:
        results: List[AuditEntry] = []
        for p in sorted(self._log_dir.glob("sandbox_audit_*.jsonl"), reverse=True):
            with open(p, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    entry = AuditEntry.from_json(line)
                    if sandbox_id and entry.sandbox_id != sandbox_id:
                        continue
                    if operation and entry.operation != operation:
                        continue
                    results.append(entry)
                    if len(results) >= limit:
                        return results
        return results
