"""W5 API orchestration: 华东零售 · 月度经营问数 + 知识图核验.

Closed loop (hermetic, no UI / no customer B-pack):

1. explain → executed=false / channel untouched
2. execute read-only → rows returned
3. publish knowledge drafts → GraphStore
4. neighborhood sees Chinese-named nodes + edges
5. write-gate denial sample (SQL + optional secondary warning)

Run (from repo root, Mac/CI)::

    pytest tests/safe_query/test_w5_east_china_retail_complex_case.py -q
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.knowledge.graphers.incremental.publish import (
    publish_objects,
    publish_to_store,
    submit_for_review,
)
from agenticx.knowledge.graphers.store import InMemoryGraphStore
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore
from agenticx.managed.templates.data_suite import (
    CODE_WRITE_GUARD_DENIED,
    FakeQueryChannel,
    run_nl2sql,
)
from agenticx.managed.testing import ScriptStep, ScriptedLLM, StaticLLMFactory

from tests.safe_query.east_china_retail_case import (
    CASE_NAME,
    CASE_QUESTION,
    build_fake_channel,
    build_scripted_nl2sql_factory,
    case_llm_context,
    load_knowledge_seed,
    seed_knowledge_drafts,
)


def test_east_china_retail_safe_query_api_closed_loop(tmp_path: Path) -> None:
    assert "华东零售" in CASE_NAME
    assert CASE_QUESTION == "上月华东大区 GMV 和退货率分别是多少？"

    channel, scripted_sql, expected_rows = build_fake_channel()
    factory = build_scripted_nl2sql_factory(scripted_sql)
    ctx = case_llm_context()

    # --- 1) explain: plan only, never hits channel ---
    explained = run_nl2sql(
        CASE_QUESTION,
        llm_factory=factory,
        channel=channel,
        context=ctx,
        mode="explain",
    )
    assert explained.refused is False
    assert explained.mode == "explain"
    assert explained.executed is False
    assert explained.rows == []
    assert channel.calls == []
    assert "华东大区" in explained.sql or "monthly_ops" in explained.sql.lower()

    # Re-bind a fresh scripted LLM (ScriptedLLM is single-shot by design).
    factory = build_scripted_nl2sql_factory(scripted_sql)

    # --- 2) execute read-only ---
    executed = run_nl2sql(
        CASE_QUESTION,
        llm_factory=factory,
        channel=channel,
        context=ctx,
        mode="execute",
    )
    assert executed.refused is False
    assert executed.mode == "execute"
    assert executed.executed is True
    assert executed.rows == expected_rows
    assert channel.calls == [executed.sql]
    assert executed.rows[0]["大区"] == "华东大区"
    assert executed.rows[0]["GMV"] == 128500000.0
    assert executed.rows[0]["退货率"] == pytest.approx(0.032)

    # --- 3) knowledge: draft → review → publish → graph ---
    obj_store = KnowledgeObjectFileStore(tmp_path / "knowledge")
    object_ids = seed_knowledge_drafts(obj_store)
    seed = load_knowledge_seed()
    entity_ids = [o["id"] for o in seed["objects"] if o["kind"] == "entity"]
    relation_ids = [o["id"] for o in seed["objects"] if o["kind"] == "relation"]
    assert len(entity_ids) >= 2
    assert len(relation_ids) >= 1
    assert set(object_ids) == set(entity_ids) | set(relation_ids)

    # Chinese attrs present on drafts
    gmv = obj_store.get_object("metric-east-gmv")
    assert gmv.attrs.get("指标名称") == "成交总额"
    assert gmv.attrs.get("大区") == "华东大区"
    assert gmv.attrs.get("业务口径")

    submit_for_review(obj_store, object_ids)
    publish_objects(obj_store, object_ids)

    gstore = InMemoryGraphStore()

    def _optional_index_hook(_result: dict) -> None:
        raise RuntimeError("可选索引重建失败（演示次要副作用）")

    stats = publish_to_store(
        obj_store,
        gstore,
        object_ids=object_ids,
        secondary_hooks=[_optional_index_hook],
    )
    assert stats["ok"] is True  # primary succeeded — do not lie
    assert stats["entities_upserted"] == len(entity_ids)
    assert stats["relations_upserted"] == len(relation_ids)
    assert stats["warnings"]  # secondary failure exposed
    assert any("secondary_hook_failed:" in w for w in stats["warnings"])
    assert stats["primary_failures"] == []

    # --- 4) neighborhood via sole recommended read facade ---
    nb = gstore.neighborhood("metric-east-gmv", depth=1, limit=50)
    assert nb["center_id"] == "metric-east-gmv"
    node_ids = {n["id"] for n in nb["nodes"]}
    assert "metric-east-gmv" in node_ids
    assert "table-order-fact" in node_ids
    assert any(n.get("name") == "GMV" for n in nb["nodes"])
    assert any(n.get("name") == "订单事实" for n in nb["nodes"])
    edge_ids = {e["id"] for e in nb["edges"]}
    assert "rel-gmv-depends-orders" in edge_ids

    # Chinese attributes survived publish → store
    gmv_entity = gstore.get_entity("metric-east-gmv")
    assert gmv_entity is not None
    assert gmv_entity.attributes.get("指标名称") == "成交总额"
    assert gmv_entity.attributes.get("大区") == "华东大区"

    return_nb = gstore.neighborhood("metric-east-return-rate", depth=1, limit=50)
    assert "table-order-fact" in {n["id"] for n in return_nb["nodes"]}
    assert any(n.get("name") == "退货率" for n in return_nb["nodes"])

    # --- 5) write-gate denial sample (non-readonly SQL never touches channel) ---
    deny_channel = FakeQueryChannel([{"should_not": "appear"}])
    deny_factory = StaticLLMFactory(
        ScriptedLLM([ScriptStep(content="DELETE FROM monthly_ops WHERE region = '华东大区'")])
    )
    denied = run_nl2sql(
        "删掉华东大区上月经营数据",
        llm_factory=deny_factory,
        channel=deny_channel,
        context=ctx,
        mode="execute",
    )
    assert denied.refused is True
    assert denied.executed is False
    assert CODE_WRITE_GUARD_DENIED in (denied.reason or "")
    assert (denied.code or "") == CODE_WRITE_GUARD_DENIED or CODE_WRITE_GUARD_DENIED in (
        denied.reason or ""
    )
    assert deny_channel.calls == []
