#!/usr/bin/env python3
"""压缩记账：start…end 括起来，锁最后释放。

这条不变量守的是"崩溃留下可检测的孤儿锁，而不是一句已完成的谎"——压缩是破坏性的，
它把真实历史换成摘要，中途崩溃如果看起来像完成了，那段原文就永远找不回来了。
"""

from __future__ import annotations

import json
import os

import pytest

from agenticx.runtime import compaction_journal as cj


class _Session:
    def __init__(self, session_id="sess-1"):
        self.session_id = session_id


@pytest.fixture
def rooted(tmp_path, monkeypatch):
    monkeypatch.setattr(cj, "_sessions_root", lambda: tmp_path)
    return tmp_path


def _journal(root, session_id="sess-1"):
    path = root / session_id / cj.JOURNAL_FILENAME
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def test_happy_path_leaves_no_lock_and_a_complete_journal(rooted):
    session = _Session()
    lock = cj.begin(session, trigger="pressure")
    assert lock.path is not None and lock.path.is_file()
    assert cj.detect_orphan(session) is not None  # 在飞的时候锁就该看得见

    cj.end(lock, outcome="summarized", compacted_count=12)

    assert not (rooted / "sess-1" / cj.LOCK_FILENAME).exists()
    assert cj.detect_orphan(session) is None
    events = _journal(rooted)
    assert [e["event"] for e in events] == [cj.EVENT_START, cj.EVENT_END]
    assert events[1]["outcome"] == "summarized" and events[1]["compacted_count"] == 12
    assert events[1]["duration_seconds"] >= 0


def test_crash_between_start_and_end_leaves_a_detectable_orphan(rooted):
    """模拟进程在压缩中途死掉：只 begin 不 end。"""
    session = _Session()
    cj.begin(session, trigger="pressure")

    orphan = cj.detect_orphan(session)
    assert orphan is not None
    assert orphan["pid"] == os.getpid()
    assert orphan["trigger"] == "pressure"
    assert orphan["age_seconds"] is not None
    # 关键：日志里只有 start，没有 end——不会被误读成"已完成"。
    assert [e["event"] for e in _journal(rooted)] == [cj.EVENT_START]


def test_orphan_is_taken_over_not_treated_as_a_deadlock(rooted, caplog):
    """上一次崩溃不该让这个会话从此再也压不了。"""
    session = _Session()
    cj.begin(session, trigger="pressure")  # 孤儿
    with caplog.at_level("WARNING", logger="agenticx.runtime.compaction_journal"):
        lock = cj.begin(session, trigger="pressure")
    assert lock.recovered_from_orphan is True
    assert any("orphan lock" in r.getMessage() for r in caplog.records)
    events = _journal(rooted)
    assert events[-1]["recovered_from_orphan"] is True

    cj.end(lock, outcome="summarized")
    assert cj.detect_orphan(session) is None


def test_lock_is_released_last(rooted, monkeypatch):
    """先删锁再记 end 的话，崩在中间就和正常完成无法区分。"""
    session = _Session()
    lock = cj.begin(session)
    order: list[str] = []

    real_append = cj._append_journal

    def _tracking_append(path, record):
        order.append(f"journal:{record.get('event')}")
        real_append(path, record)

    lock_path = lock.path
    assert lock_path is not None
    original_unlink = type(lock_path).unlink

    def _tracking_unlink(self, *args, **kwargs):
        order.append("unlink")
        return original_unlink(self, *args, **kwargs)

    monkeypatch.setattr(cj, "_append_journal", _tracking_append)
    monkeypatch.setattr(type(lock_path), "unlink", _tracking_unlink)
    cj.end(lock, outcome="pruned")
    assert order == [f"journal:{cj.EVENT_END}", "unlink"]


def test_corrupt_lock_still_counts_as_a_lock(rooted):
    """锁的**存在**才是信号，内容只是附加信息。"""
    session = _Session()
    cj.begin(session)
    (rooted / "sess-1" / cj.LOCK_FILENAME).write_text("not json", encoding="utf-8")
    orphan = cj.detect_orphan(session)
    assert orphan is not None and orphan["pid"] is None


def test_a_failed_release_stays_an_orphan_rather_than_pretending(rooted, monkeypatch, caplog):
    """删不掉就留成孤儿锁：宁可下次多一条 warning，也不能假装没发生过。"""
    session = _Session()
    lock = cj.begin(session)
    assert lock.path is not None
    monkeypatch.setattr(
        type(lock.path),
        "unlink",
        lambda *_a, **_k: (_ for _ in ()).throw(PermissionError("read-only fs")),
    )
    with caplog.at_level("WARNING", logger="agenticx.runtime.compaction_journal"):
        cj.end(lock, outcome="summarized")
    assert any("lock release failed" in r.getMessage() for r in caplog.records)
    assert cj.detect_orphan(session) is not None


def test_sessions_without_an_id_work_without_bookkeeping(rooted):
    """内存会话照常压缩，只是不记账——不该因为没有 session_id 就崩。"""

    class _Anon:
        pass

    lock = cj.begin(_Anon())
    assert lock.path is None and lock.journal is None
    cj.end(lock, outcome="summarized")  # 不该抛
    assert cj.detect_orphan(_Anon()) is None


@pytest.mark.parametrize("bad", ["", "..", "a/b", f"x{os.sep}y"])
def test_session_ids_cannot_escape_the_sessions_root(rooted, bad):
    class _S:
        session_id = bad

    assert cj.session_dir(_S()) is None
