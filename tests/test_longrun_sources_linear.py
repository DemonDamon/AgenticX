#!/usr/bin/env python3
"""Contract tests for Linear task source (mocked HTTP).

Author: Damon Li
"""

from __future__ import annotations

import pytest

pytest.importorskip("httpx")


@pytest.mark.asyncio
async def test_linear_task_source_parses_nodes(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.longrun.sources.linear_source import LinearTaskSource

    class _Resp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "data": {
                    "issues": {
                        "nodes": [
                            {
                                "id": "abc",
                                "identifier": "TST-1",
                                "title": "Hello",
                                "description": "World",
                            }
                        ]
                    }
                }
            }

    class _Client:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "_Client":
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def post(self, url: str, json: dict | None = None, headers: dict | None = None) -> _Resp:
            return _Resp()

    import agenticx.longrun.sources.linear_source as ls

    monkeypatch.setattr(ls.httpx, "AsyncClient", _Client)

    src = LinearTaskSource(api_key="test-key")
    rows = await src.fetch_pending_tasks()
    assert len(rows) == 1
    assert rows[0]["id"] == "linear-abc"
    assert "Hello" in rows[0]["task"]
