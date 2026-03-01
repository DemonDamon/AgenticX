#!/usr/bin/env python3
"""Smoke tests for session write lock.

Author: Damon Li
"""

from pathlib import Path

import pytest

from agenticx.sessions.write_lock import SessionWriteLock, SessionWriteLockTimeout


class TestSessionWriteLock:
    def test_acquire_and_release(self, tmp_path: Path):
        lock_path = tmp_path / "session.lock"
        lock = SessionWriteLock(lock_file=lock_path, timeout_seconds=0.2, poll_interval_seconds=0.01)

        lock.acquire()
        assert lock_path.exists()
        lock.release()
        assert not lock_path.exists()

    def test_duplicate_lock_times_out(self, tmp_path: Path):
        lock_path = tmp_path / "session.lock"
        lock1 = SessionWriteLock(lock_file=lock_path, timeout_seconds=0.2, poll_interval_seconds=0.01)
        lock2 = SessionWriteLock(lock_file=lock_path, timeout_seconds=0.1, poll_interval_seconds=0.01)
        lock1.acquire()

        with pytest.raises(SessionWriteLockTimeout):
            lock2.acquire()

        lock1.release()

    def test_reentrant_after_release(self, tmp_path: Path):
        lock_path = tmp_path / "session.lock"
        lock = SessionWriteLock(lock_file=lock_path, timeout_seconds=0.2, poll_interval_seconds=0.01)

        with lock:
            assert lock_path.exists()
        assert not lock_path.exists()

        with SessionWriteLock(lock_file=lock_path, timeout_seconds=0.2, poll_interval_seconds=0.01):
            assert lock_path.exists()

    def test_release_without_ownership_keeps_existing_lock(self, tmp_path: Path):
        lock_path = tmp_path / "session.lock"
        lock_path.write_text("external-owner", encoding="utf-8")

        lock = SessionWriteLock(lock_file=lock_path, timeout_seconds=0.1, poll_interval_seconds=0.01)
        lock.release()

        assert lock_path.exists()
