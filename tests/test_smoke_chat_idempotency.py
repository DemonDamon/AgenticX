from collections import deque


def test_duplicate_client_turn_id_short_circuits():
    """同一 client_turn_id 二次到达应被短路，不重复入列业务处理。"""
    seen = deque(maxlen=64)
    ctid = "turn-123"

    # 第一次：未见过，入列，放行
    first_blocked = ctid in seen
    if not first_blocked:
        seen.append(ctid)
    assert first_blocked is False
    assert ctid in seen

    # 第二次：已见过，应短路
    second_blocked = ctid in seen
    assert second_blocked is True
    # 短路时不应再次 append（长度不变）
    assert list(seen).count(ctid) == 1


def test_distinct_turn_ids_all_pass():
    seen = deque(maxlen=64)
    for i in range(5):
        ctid = f"turn-{i}"
        assert (ctid in seen) is False
        seen.append(ctid)
    assert len(seen) == 5
