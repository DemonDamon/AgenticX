"""记忆记录的时间戳必须是 aware 的。

这不是风格问题。core_memory 建记录时用过 ``datetime.now()``（naive），而所有做时间
运算的地方用的是 ``datetime.now(UTC)``（aware）：

    age_hours = (datetime.now(UTC) - record.created_at).total_seconds() / 3600

两者相减直接抛 TypeError。也就是说，只要记录是从 core_memory 这条路建出来的，检索时
算相关度、算时间衰减、按 max_age 过滤全都会崩——不是结果不准，是整个调用炸掉。

Author: Damon Li
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from agenticx.memory.hierarchical import (
    HierarchicalMemoryRecord,
    MemoryImportance,
    MemoryType,
    ensure_aware,
)


def _record(created_at: datetime) -> HierarchicalMemoryRecord:
    return HierarchicalMemoryRecord(
        id="r1",
        content="hello",
        metadata={},
        tenant_id="t1",
        created_at=created_at,
        updated_at=created_at,
        memory_type=MemoryType.CORE,
        importance=MemoryImportance.HIGH,
    )


def test_ensure_aware_treats_naive_as_local_time() -> None:
    """naive 值当初是 datetime.now() 出来的本地时间，补的就该是本地时区。

    当成 UTC 的话，UTC+8 上的老记录会凭空老 8 小时，时间衰减跟着一起错。
    """
    naive = datetime(2026, 1, 1, 12, 0, 0)
    assert naive.tzinfo is None
    aware = ensure_aware(naive)
    assert aware.tzinfo is not None
    # 本地时钟读数不变，只是补上了偏移量
    assert aware.replace(tzinfo=None) == naive


def test_ensure_aware_leaves_aware_values_alone() -> None:
    aware = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
    assert ensure_aware(aware) is aware


def test_age_math_works_on_legacy_naive_records() -> None:
    """已经落盘的老记录仍是 naive，读取侧必须兜得住。"""
    legacy = _record(datetime.now() - timedelta(hours=3))
    age = (datetime.now(UTC) - ensure_aware(legacy.created_at)).total_seconds() / 3600
    assert 2.5 < age < 3.5


def test_raw_subtraction_on_naive_still_raises() -> None:
    """反向确认这个坑本身还在：不经 ensure_aware 就会炸。

    这条是给未来的人看的——如果哪天它不再抛异常，说明底层语义变了，上面几条兜底
    就该重新审一遍，而不是默默留着。
    """
    legacy = _record(datetime.now())
    with pytest.raises(TypeError, match="offset-naive and offset-aware"):
        _ = datetime.now(UTC) - legacy.created_at
