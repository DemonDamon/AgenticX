import os

import pytest

from agenticx.data_suite.channels.clickhouse import ClickHouseChannel
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.base import WriteDeniedError


class _FakeClient:
    def __init__(self):
        self.last = None

    def query(self, sql):
        class R:
            column_names = ["x"]
            result_rows = [[1]]

        if sql.strip().upper().startswith("SHOW TABLES"):
            class T:
                column_names = ["name"]
                result_rows = [["events"]]

            return T()
        return R()

    def command(self, sql):
        return None

    def insert(self, table, rows, column_names):
        self.last = (table, rows, column_names)


def test_clickhouse_query_with_fake_client():
    ch = ClickHouseChannel(name="ch", client=_FakeClient(), grants=WriteGrantStore())
    q = ch.query("SELECT 1", limit=10)
    assert q.rows == [[1]]


def test_clickhouse_probe_with_fake_client():
    ch = ClickHouseChannel(name="ch", client=_FakeClient())
    r = ch.probe()
    assert r.ok is True
    assert "events" in r.tables


def test_clickhouse_query_rejects_writes():
    ch = ClickHouseChannel(name="ch", client=_FakeClient())
    with pytest.raises(ValueError):
        ch.query("DELETE FROM events")


def test_clickhouse_write_requires_grant():
    client = _FakeClient()
    grants = WriteGrantStore(grants={"g1": {"channel": "ch", "table": "events"}})
    ch = ClickHouseChannel(name="ch", client=client, grants=grants)
    with pytest.raises(WriteDeniedError):
        ch.write_rows("events", [{"x": 1}], grant_id="nope")
    assert ch.write_rows("events", [{"x": 1}], grant_id="g1") == 1
    assert client.last[0] == "events"


def test_clickhouse_missing_driver_probe():
    ch = ClickHouseChannel(name="ch", _cfg={"host": "localhost"})
    # Force lazy path without client; may or may not have driver installed.
    # Simulate missing by stubbing _ensure_client via no client and no package:
    # We just assert the error string contract when ImportError path runs.
    try:
        import clickhouse_connect  # noqa: F401
        pytest.skip("clickhouse-connect installed; skip missing-driver path")
    except ImportError:
        r = ch.probe()
        assert r.ok is False
        assert "clickhouse-connect not installed" in (r.error or "")


@pytest.mark.integration
@pytest.mark.skipif(not os.getenv("AGX_CH_URL"), reason="AGX_CH_URL not set")
def test_live_clickhouse_probe():
    ch = ClickHouseChannel.from_env()
    assert ch.probe().ok is True
