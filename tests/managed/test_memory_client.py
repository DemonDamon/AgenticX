#!/usr/bin/env python3
"""Enterprise memory client mapping and the in-memory CAS stand-in.

Author: Damon Li
"""

from __future__ import annotations

import json

import httpx
import pytest

from agenticx.managed.memory import (
    EnterpriseMemoryStoreClient,
    InMemoryMemoryStoreClient,
    MemoryServiceError,
    MemoryWriteOp,
    content_sha256,
)


def _transport(handler):
    return httpx.MockTransport(handler)


async def test_enterprise_client_maps_snapshot_and_batched_writes() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == "Bearer it"
        if request.url.path.endswith("/snapshot"):
            assert request.url.params["tenant_id"] == "tenant"
            assert request.url.params["session_id"] == "session"
            return httpx.Response(
                200,
                json={
                    "memory_store": {
                        "id": "store",
                        "name": "Notes",
                        "status": "active",
                    },
                    "memories": [
                        {
                            "id": "mem1",
                            "path": "/a.md",
                            "content": "hello",
                            "content_sha256": content_sha256("hello"),
                            "size_bytes": 5,
                            "version": 3,
                        }
                    ],
                },
            )
        if request.url.path.endswith("/writes"):
            body = json.loads(request.content.decode("utf-8"))
            results = []
            for index, op in enumerate(body["ops"]):
                results.append(
                    {
                        "index": index,
                        "ok": True,
                        "memory": {
                            "id": f"id-{index}",
                            "path": op["path"],
                            "version": 1,
                            "content_sha256": "abc",
                        },
                    }
                )
            return httpx.Response(200, json={"results": list(reversed(results))})
        return httpx.Response(
            500, json={"error": {"code": "internal_error", "message": "no"}}
        )

    client = EnterpriseMemoryStoreClient(
        "http://memory.test", "it", transport=_transport(handler)
    )
    try:
        assert "it" not in repr(client)
        snap = await client.snapshot("tenant", "session", "store")
        assert snap.name == "Notes"
        assert snap.entries[0].memory_id == "mem1"
        assert snap.entries[0].content == "hello"
        assert snap.entries[0].version == 3
        ops = [
            MemoryWriteOp("create", f"/p{index}.md", content="x")
            for index in range(120)
        ]
        written = await client.write("tenant", "session", "store", ops)
        write_requests = [
            item for item in requests if item.url.path.endswith("/writes")
        ]
        assert len(write_requests) == 3
        assert [len(json.loads(item.content)["ops"]) for item in write_requests] == [
            50,
            50,
            20,
        ]
        assert [item.head.path for item in written if item.head is not None] == [
            f"/p{i}.md" for i in range(120)
        ]
    finally:
        await client.aclose()


async def test_enterprise_client_classifies_http_errors() -> None:
    mode = {"status": 403, "code": "forbidden_scope"}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer it"
        return httpx.Response(
            mode["status"],
            json={
                "error": {"code": mode["code"], "message": "secret-body-do-not-leak"}
            },
        )

    client = EnterpriseMemoryStoreClient(
        "http://memory.test", "it", transport=_transport(handler)
    )
    try:
        with pytest.raises(MemoryServiceError) as forbidden:
            await client.snapshot("tenant", "session", "store")
        assert forbidden.value.transient is False
        assert forbidden.value.status == 403
        assert forbidden.value.code == "forbidden_scope"
        assert "secret-body-do-not-leak" not in str(forbidden.value)
        mode["status"] = 500
        mode["code"] = "internal_error"
        with pytest.raises(MemoryServiceError) as failed:
            await client.snapshot("tenant", "session", "store")
        assert failed.value.transient is True
        assert failed.value.status == 500
        assert "secret-body-do-not-leak" not in str(failed.value)
    finally:
        await client.aclose()


async def test_in_memory_cas() -> None:
    client = InMemoryMemoryStoreClient()
    client.add_store("S", "Notes")
    client.mount("tenant", "session", "S", "read_write")
    created = await client.write(
        "tenant",
        "session",
        "S",
        [MemoryWriteOp("create", "/a", content="one")],
    )
    assert created[0].ok is True
    assert created[0].head is not None
    duplicate = await client.write(
        "tenant",
        "session",
        "S",
        [MemoryWriteOp("create", "/a", content="two")],
    )
    assert duplicate[0].ok is False
    assert duplicate[0].code == "memory_path_conflict"
    assert duplicate[0].head is not None
    assert duplicate[0].head.memory_id == created[0].head.memory_id
    nested = await client.write(
        "tenant",
        "session",
        "S",
        [MemoryWriteOp("create", "/a/b", content="child")],
    )
    assert nested[0].code == "memory_path_conflict"
    assert nested[0].head is not None
    assert nested[0].head.path == "/a"
    stale = await client.write(
        "tenant",
        "session",
        "S",
        [
            MemoryWriteOp(
                "update",
                "/a",
                content="three",
                memory_id=created[0].head.memory_id,
                expected_version=created[0].head.version - 1,
            )
        ],
    )
    assert stale[0].code == "memory_version_conflict"
    assert stale[0].head is not None
    assert stale[0].head.version == created[0].head.version
    with pytest.raises(MemoryServiceError) as unmounted:
        await client.snapshot("tenant", "other", "S")
    assert unmounted.value.status == 403
    assert unmounted.value.code == "forbidden_scope"
    client.mount("tenant", "reader", "S", "read_only")
    with pytest.raises(MemoryServiceError) as readonly:
        await client.write(
            "tenant",
            "reader",
            "S",
            [MemoryWriteOp("create", "/b", content="no")],
        )
    assert readonly.value.status == 403
    assert readonly.value.code == "forbidden_scope"
