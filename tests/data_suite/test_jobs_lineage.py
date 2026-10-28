from agenticx.data_suite.jobs.lineage import LineageLog


def test_lineage_append_only():
    log = LineageLog()
    log.record("a", inputs={"n": 1}, outputs={"n": 1})
    log.record("b", inputs={"n": 1}, outputs={"n": 0}, meta={"drop": ["id"]})
    assert len(log.events) == 2
    assert log.events[0]["node_id"] == "a"
    assert "ts" in log.events[0]
    assert log.events[1]["meta"]["drop"] == ["id"]
