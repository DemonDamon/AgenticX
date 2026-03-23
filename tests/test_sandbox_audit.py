#!/usr/bin/env python3
"""Tests for SandboxAuditTrail.

Author: Damon Li
"""

import json
import tempfile
from pathlib import Path

import pytest

from agenticx.sandbox.audit import AuditEntry, SandboxAuditTrail


class TestSandboxAuditTrail:
    def setup_method(self):
        self.tmpdir = tempfile.mkdtemp()
        self.trail = SandboxAuditTrail(log_dir=self.tmpdir)

    def test_record_creates_jsonl_file(self):
        self.trail.record(
            sandbox_id="sb-test123",
            operation="execute",
            code="print('hello')",
            exit_code=0,
            duration_ms=42.5,
        )
        files = list(Path(self.tmpdir).glob("*.jsonl"))
        assert len(files) == 1

    def test_record_entry_is_valid_json(self):
        self.trail.record(
            sandbox_id="sb-test123",
            operation="run_command",
            code="ls -la",
            exit_code=0,
            duration_ms=10.0,
        )
        files = list(Path(self.tmpdir).glob("*.jsonl"))
        with open(files[0], encoding="utf-8") as f:
            entry = json.loads(f.readline())
        assert entry["sandbox_id"] == "sb-test123"
        assert entry["operation"] == "run_command"
        assert "timestamp" in entry
        assert "code_hash" in entry

    def test_query_by_sandbox_id(self):
        self.trail.record(
            sandbox_id="sb-aaa",
            operation="execute",
            code="1+1",
            exit_code=0,
            duration_ms=1.0,
        )
        self.trail.record(
            sandbox_id="sb-bbb",
            operation="execute",
            code="2+2",
            exit_code=0,
            duration_ms=1.0,
        )
        results = self.trail.query(sandbox_id="sb-aaa")
        assert len(results) == 1
        assert results[0].sandbox_id == "sb-aaa"

    def test_rotate_when_file_exceeds_max_size(self):
        self.trail = SandboxAuditTrail(log_dir=self.tmpdir, max_file_bytes=100)
        for i in range(20):
            self.trail.record(
                sandbox_id=f"sb-{i}",
                operation="execute",
                code=f"x={i}",
                exit_code=0,
                duration_ms=1.0,
            )
        files = list(Path(self.tmpdir).glob("*.jsonl"))
        assert len(files) >= 2
