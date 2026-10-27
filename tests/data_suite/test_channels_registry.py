import pytest

from agenticx.data_suite.channels.base import WriteDeniedError
from agenticx.data_suite.channels.fake import FakeChannel
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.registry import ChannelRegistry


def test_fake_probe_and_query():
    ch = FakeChannel(name="jdbc_demo", tables={"users": [{"id": 1, "n": "a"}]})
    assert ch.probe().ok is True
    q = ch.query("SELECT * FROM users", limit=10)
    assert q.columns == ["id", "n"]
    assert q.rows == [[1, "a"]]


def test_fake_write_requires_grant():
    grants = WriteGrantStore(grants={"g1": {"channel": "jdbc_demo", "table": "users"}})
    ch = FakeChannel(name="jdbc_demo", tables={"users": []}, grants=grants)
    with pytest.raises(WriteDeniedError):
        ch.write_rows("users", [{"id": 2}], grant_id="nope")
    assert ch.write_rows("users", [{"id": 2}], grant_id="g1") == 1


def test_registry_get():
    reg = ChannelRegistry()
    reg.register(FakeChannel(name="hive_demo", tables={}))
    assert reg.get("hive_demo").name == "hive_demo"


def test_registry_probe_all():
    reg = ChannelRegistry()
    reg.register(FakeChannel(name="a", tables={"t": []}))
    reg.register(FakeChannel(name="b", tables={}))
    results = reg.probe_all()
    assert {r.channel for r in results} == {"a", "b"}
    assert all(r.ok for r in results)


def test_registry_unknown_raises():
    reg = ChannelRegistry()
    with pytest.raises(KeyError):
        reg.get("missing")
