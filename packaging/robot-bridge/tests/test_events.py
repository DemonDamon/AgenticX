#!/usr/bin/env python3
"""Tests for the bounded session event log.

Author: Hongyi Zhao
"""

from __future__ import annotations

import threading

from agx_robot_bridge.events import EventLog


def test_seq_is_monotonic_and_since_filters():
    log = EventLog()
    assert log.last_seq == 0
    assert log.append("a") == 1
    assert log.append("b", {"k": 1}) == 2
    events = log.since(0)
    assert [e["seq"] for e in events] == [1, 2]
    assert events[1]["type"] == "b" and events[1]["detail"] == {"k": 1}
    assert isinstance(events[0]["ts"], float)
    assert [e["type"] for e in log.since(1)] == ["b"]
    assert log.since(2) == []


def test_eviction_keeps_seq_counter():
    log = EventLog(maxlen=3)
    for i in range(5):
        log.append(f"e{i}")
    assert log.last_seq == 5
    assert [e["seq"] for e in log.since(0)] == [3, 4, 5]
    assert log.append("next") == 6


def test_since_returns_copies():
    log = EventLog()
    log.append("a", {"k": 1})
    log.since(0)[0]["detail"]["k"] = 99
    assert log.since(0)[0]["detail"] == {"k": 1}


def test_concurrent_appends_get_unique_seq():
    log = EventLog(maxlen=10_000)

    def worker() -> None:
        for _ in range(500):
            log.append("x")

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    seqs = [e["seq"] for e in log.since(0)]
    assert seqs == list(range(1, 4001))
