#!/usr/bin/env python3
"""Smoke tests for memory graph module (unit-level, no Graphiti required).

Author: Damon Li
"""

from __future__ import annotations

import sys

import pytest

from agenticx.memory.graph.clients import (
    model_supports_reasoning_effort,
    should_use_generic_openai_client,
)
from agenticx.memory.graph.embedder import CompatOpenAIEmbedder, embedder_max_batch_size
from agenticx.memory.graph.json_compat import (
    coerce_to_response_model,
    parse_llm_json,
    provider_supports_json_response_format,
)
from agenticx.memory.graph.config import load_memory_graph_config
from agenticx.memory.graph.dto import build_graph_view, map_edge, map_node
from agenticx.memory.graph.group_id import derive_group_id, validate_group_access
from agenticx.memory.graph.store import MemoryGraphStore, extract_last_turn_messages
from agenticx.memory.graph.writer import MemoryGraphWriter


class _FakeNode:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


class _FakeEdge:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


def test_provider_supports_json_response_format():
    assert provider_supports_json_response_format("openai", None) is True
    assert provider_supports_json_response_format("minimax", "https://api.minimax.chat/v1") is False
    assert provider_supports_json_response_format("openai", "https://proxy.example/v1") is False


def test_embedder_max_batch_size():
    assert embedder_max_batch_size("bailian", None) == 10
    assert embedder_max_batch_size("dashscope", "https://dashscope.aliyuncs.com/compatible-mode/v1") == 10
    assert embedder_max_batch_size("openai", None) is None


@pytest.mark.asyncio
async def test_compat_openai_embedder_chunks_bailian_batches(monkeypatch):
    from graphiti_core.embedder.openai import OpenAIEmbedder

    embedder = CompatOpenAIEmbedder(provider_name="bailian")
    calls: list[list[str]] = []

    async def _fake_create_batch(self, input_data_list: list[str]) -> list[list[float]]:
        calls.append(list(input_data_list))
        return [[float(len(text))] for text in input_data_list]

    monkeypatch.setattr(OpenAIEmbedder, "create_batch", _fake_create_batch)

    texts = [f"t{i}" for i in range(23)]
    vectors = await embedder.create_batch(texts)
    assert len(vectors) == 23
    assert [len(batch) for batch in calls] == [10, 10, 3]


def test_parse_llm_json():
    assert parse_llm_json('{"nodes":[]}') == {"nodes": []}
    assert parse_llm_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_llm_json('Here is output:\n{"fact": "x"}\n') == {"fact": "x"}


def test_parse_llm_json_tolerates_trailing_garbage():
    # Weaker models append prose after the JSON object ("Extra data").
    assert parse_llm_json('{"extracted_entities": []} 额外说明') == {"extracted_entities": []}
    # Fenced block with trailing tokens after the closing fence.
    assert parse_llm_json('```json\n{"a": 1}\n``` trailing') == {"a": 1}
    # Multiple concatenated objects: keep the first valid one.
    assert parse_llm_json('{"a": 1}\n{"b": 2}') == {"a": 1}
    # Prose prefix before the JSON object.
    assert parse_llm_json('好的，结果如下：{"a": 1}') == {"a": 1}


def test_parse_llm_json_empty_raises():
    import pytest

    with pytest.raises(ValueError, match="empty"):
        parse_llm_json("")


def test_coerce_to_response_model_renames_aliases():
    from typing import List

    from pydantic import BaseModel, Field

    class ExtractedEntity(BaseModel):
        name: str = ""
        entity_type_id: int = 0

    class ExtractedEntities(BaseModel):
        extracted_entities: List[ExtractedEntity] = Field(...)

    # MiniMax returns shortened key 'entities'
    fixed = coerce_to_response_model({"entities": [{"name": "u"}]}, ExtractedEntities)
    assert "extracted_entities" in fixed
    assert "entities" not in fixed
    assert fixed["extracted_entities"] == [{"name": "u"}]
    # constructing the model must now succeed
    assert ExtractedEntities(**fixed).extracted_entities[0].name == "u"


def test_coerce_to_response_model_wraps_singleton_entity():
    from typing import List

    from pydantic import BaseModel, Field

    class ExtractedEntity(BaseModel):
        name: str = Field(...)
        entity_type_id: int = Field(default=0)

    class ExtractedEntities(BaseModel):
        extracted_entities: List[ExtractedEntity] = Field(...)

    payload = {"entity_name": "user", "entity_type_id": 0}
    fixed = coerce_to_response_model(payload, ExtractedEntities)
    model = ExtractedEntities(**fixed)
    assert model.extracted_entities[0].name == "user"
    assert model.extracted_entities[0].entity_type_id == 0

    # MiniMax sometimes uses ``entity`` (string) instead of ``name``.
    payload = {"entity": "user", "entity_type_id": 0}
    fixed = coerce_to_response_model(payload, ExtractedEntities)
    model = ExtractedEntities(**fixed)
    assert model.extracted_entities[0].name == "user"


def test_coerce_to_response_model_wraps_singleton_edge():
    from graphiti_core.prompts.extract_edges import ExtractedEdges

    payload = {
        "source_entity_name": "Machi",
        "target_entity_name": "AgenticX",
        "relation_type": "PART_OF",
        "fact": "Machi is the Meta-Agent of AgenticX.",
        "valid_at": "2026-06-04T00:00:00Z",
        "invalid_at": None,
    }
    fixed = coerce_to_response_model(payload, ExtractedEdges)
    model = ExtractedEdges(**fixed)
    assert len(model.edges) == 1
    assert model.edges[0].source_entity_name == "Machi"
    assert model.edges[0].target_entity_name == "AgenticX"


def test_coerce_to_response_model_wraps_top_level_entity_list():
    from typing import List

    from pydantic import BaseModel, Field

    class ExtractedEntity(BaseModel):
        name: str = Field(...)
        entity_type_id: int = Field(default=0)

    class ExtractedEntities(BaseModel):
        extracted_entities: List[ExtractedEntity] = Field(...)

    payload = [{"entity_name": "user", "entity_type_id": 0}]
    fixed = coerce_to_response_model(payload, ExtractedEntities)
    model = ExtractedEntities(**fixed)
    assert model.extracted_entities[0].name == "user"


def test_coerce_to_response_model_noop_when_correct():
    from typing import List

    from pydantic import BaseModel, Field

    class NodeResolutions(BaseModel):
        entity_resolutions: List[int] = Field(...)

    data = {"entity_resolutions": [1, 2]}
    assert coerce_to_response_model(data, NodeResolutions) == data
    # alias 'resolutions' should also be mapped
    assert coerce_to_response_model({"resolutions": [3]}, NodeResolutions) == {
        "entity_resolutions": [3]
    }


def test_model_supports_reasoning_effort():
    assert model_supports_reasoning_effort("gpt-5-mini") is True
    assert model_supports_reasoning_effort("openai/gpt-5-nano") is True
    assert model_supports_reasoning_effort("o3-mini") is True
    assert model_supports_reasoning_effort("gpt-4o-mini") is False
    assert model_supports_reasoning_effort("glm-4-flash") is False


def test_should_use_generic_openai_client():
    assert should_use_generic_openai_client("openai", None, "gpt-4o-mini") is True
    assert should_use_generic_openai_client("openai", None, "gpt-5-mini") is False
    assert should_use_generic_openai_client("ollama", "http://127.0.0.1:11434", "llama3") is True
    assert should_use_generic_openai_client("minimax", "https://api.minimax.io/v1", "MiniMax-M3") is True
    assert should_use_generic_openai_client(
        "openai", "https://my-litellm.example/v1", "gpt-5-mini"
    ) is True


def test_store_reset_runtime_clears_ready_flag():
    store = MemoryGraphStore()
    store._ready = True
    store._graphiti = object()
    store.reset_runtime()
    assert store._ready is False
    assert store._graphiti is None


def test_group_id_derivation():
    assert derive_group_id("meta") == "meta_default"
    assert derive_group_id("avatar", avatar_id="dev") == "avatar_dev"
    assert derive_group_id("session", session_id="s1") == "session_s1"
    # 群聊 avatar_id（group:<gid>）应净化为 Kuzu 安全编码
    assert derive_group_id("group", avatar_id="group:team-x") == "group_team-x"
    # 冒号等非法字符被净化为下划线
    assert derive_group_id("avatar", avatar_id="automation:t1") == "avatar_automation_t1"


def test_validate_group_access_session():
    gid = derive_group_id("session", session_id="abc")
    assert validate_group_access(gid, avatar_id=None, session_id="abc") is True
    assert validate_group_access(gid, avatar_id=None, session_id="other") is False


def test_validate_group_access_meta_without_session():
    gid = derive_group_id("meta")
    assert validate_group_access(gid, avatar_id=None, session_id=None) is True
    assert validate_group_access(gid, avatar_id=None, session_id="") is True


def test_overview_dto_shape():
    node = _FakeNode(uuid="n1", name="Alice", summary="Engineer")
    edge = _FakeEdge(
        uuid="e1",
        source_node_uuid="n1",
        target_node_uuid="n2",
        fact="works_with",
        invalid_at=None,
    )
    view = build_graph_view(group_id="session:1", nodes=[node], edges=[edge])
    assert view["meta"]["groupId"] == "session:1"
    assert view["nodes"][0]["kind"] == "entity"
    assert view["edges"][0]["status"] == "active"


def test_map_edge_invalidated():
    edge = _FakeEdge(
        uuid="e1",
        source_node_uuid="a",
        target_node_uuid="b",
        fact="old fact",
        invalid_at="2026-01-01T00:00:00+00:00",
    )
    dto = map_edge(edge)
    assert dto["status"] == "invalidated"


def test_extract_last_turn_messages():
    history = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi there"},
        {"role": "user", "content": "second"},
        {"role": "assistant", "content": "reply two"},
    ]
    pair = extract_last_turn_messages(history)
    assert len(pair) == 2
    assert pair[0]["content"] == "second"
    assert pair[1]["content"] == "reply two"


def test_status_store_clears_last_error_on_new_job(tmp_path):
    from agenticx.memory.graph.status import MemoryGraphStatusStore

    store = MemoryGraphStatusStore(tmp_path / "graph_ingest.json")
    store.record_failure("Request timed out.")
    store.increment_pending(1)
    state = store.read()
    assert state["last_error"] is None
    store.record_failure("again")
    store.mark_job_started()
    state = store.read()
    assert state["last_error"] is None
    assert state["job_active"] is True


def test_disabled_config_skips_writer(monkeypatch):
    monkeypatch.setenv("AGX_MEMORY_GRAPH_ENABLED", "0")
    cfg = load_memory_graph_config()
    assert cfg.enabled is False
    writer = MemoryGraphWriter()
    import asyncio

    ok = asyncio.run(
        writer.enqueue_turn(
            group_id="session:x",
            session_id="x",
            messages=[{"role": "user", "content": "test"}],
        )
    )
    assert ok is False


@pytest.mark.asyncio
async def test_ingest_queue_does_not_block_when_disabled(monkeypatch):
    monkeypatch.setenv("AGX_MEMORY_GRAPH_ENABLED", "0")
    writer = MemoryGraphWriter.singleton()
    writer.cfg = load_memory_graph_config()
    ok = await writer.enqueue_turn(
        group_id="session:1",
        session_id="1",
        messages=[{"role": "user", "content": "x"}],
    )
    assert ok is False


def test_store_refresh_config_picks_up_enabled_toggle(monkeypatch):
    """Singleton must not keep stale enabled=false after config changes."""

    class _Disabled:
        enabled = False
        backend = "kuzu"
        db_path = __import__("pathlib").Path("/tmp/x.kuzu")
        default_scope = "session"
        ingest = type("I", (), {"auto": True, "max_queue": 8, "semaphore_limit": 1, "max_chars_per_episode": 1000})()
        llm = type("L", (), {"provider": "", "model": ""})()
        embedder = type("E", (), {"provider": "", "model": ""})()
        telemetry = False
        status_path = __import__("pathlib").Path("/tmp/status.json")

    class _Enabled(_Disabled):
        enabled = True

    current = _Disabled()
    monkeypatch.setattr("agenticx.memory.graph.store.load_memory_graph_config", lambda: current)

    store = MemoryGraphStore()
    assert store.get_status()["enabled"] is False

    current = _Enabled()
    assert store.get_status()["enabled"] is True


def test_graphiti_install_hint_uses_running_interpreter():
    from agenticx.memory.graph.deps import graphiti_install_hint

    hint = graphiti_install_hint()
    assert sys.executable in hint
    assert "graphiti-core" in hint


def test_prepare_kuzu_driver_sets_database():
    """Regression: Graphiti.add_episode must not raise on missing _database."""
    pytest.importorskip("graphiti_core")
    from graphiti_core.driver.kuzu_driver import KuzuDriver

    from agenticx.memory.graph.store import _prepare_kuzu_driver

    driver = KuzuDriver(db=":memory:")
    assert not hasattr(driver, "_database")
    _prepare_kuzu_driver(driver)
    assert hasattr(driver, "_database")
    cloned = driver.clone("meta_default")
    assert cloned._database == "meta_default"
