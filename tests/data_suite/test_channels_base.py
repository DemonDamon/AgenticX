import pytest

from agenticx.data_suite.channels.base import (
    ChannelProbeResult,
    ChannelQueryResult,
    WriteDeniedError,
)


def test_probe_result_to_dict():
    r = ChannelProbeResult(channel="ch", ok=True, dialect="clickhouse", tables=["t1"])
    assert r.to_dict()["tables"] == ["t1"]


def test_query_result_truncated_flag():
    q = ChannelQueryResult(columns=["a"], rows=[[1]], truncated=True)
    assert q.truncated is True


def test_write_denied_is_runtime_error():
    with pytest.raises(WriteDeniedError):
        raise WriteDeniedError("missing grant")
