#!/usr/bin/env python3
"""Click-equivalent API/CLI evidence for W6 when documenting closed loop."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

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
    CASE_QUESTION,
    build_fake_channel,
    build_scripted_nl2sql_factory,
    case_llm_context,
    load_knowledge_seed,
    seed_knowledge_drafts,
)

OUT = Path(__file__).resolve().parent


def main() -> None:
    evidence: dict = {"case_question": CASE_QUESTION, "steps": {}}
    channel, scripted_sql, expected_rows = build_fake_channel()
    factory = build_scripted_nl2sql_factory(scripted_sql)
    ctx = case_llm_context()

    explained = run_nl2sql(
        CASE_QUESTION, llm_factory=factory, channel=channel, context=ctx, mode="explain"
    )
    evidence["steps"]["A2_explain"] = {
        "mode": explained.mode,
        "executed": explained.executed,
        "sql": explained.sql,
        "rows": explained.rows,
        "channel_calls": list(channel.calls),
        "ok": explained.executed is False and channel.calls == [],
    }

    factory = build_scripted_nl2sql_factory(scripted_sql)
    executed = run_nl2sql(
        CASE_QUESTION, llm_factory=factory, channel=channel, context=ctx, mode="execute"
    )
    evidence["steps"]["A3_execute"] = {
        "mode": executed.mode,
        "executed": executed.executed,
        "rows": executed.rows,
        "ok": executed.executed is True and executed.rows == expected_rows,
    }

    deny_channel = FakeQueryChannel([{"should_not": "appear"}])
    deny_factory = StaticLLMFactory(
        ScriptedLLM(
            [ScriptStep(content="DELETE FROM monthly_ops WHERE region = '华东大区'")]
        )
    )
    denied = run_nl2sql(
        "删掉华东大区上月经营数据",
        llm_factory=deny_factory,
        channel=deny_channel,
        context=ctx,
        mode="execute",
    )
    evidence["steps"]["A1_write_gate"] = {
        "refused": denied.refused,
        "code": denied.code,
        "reason": denied.reason,
        "channel_calls": list(deny_channel.calls),
        "ok": denied.refused and CODE_WRITE_GUARD_DENIED in (denied.reason or ""),
    }

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        obj_store = KnowledgeObjectFileStore(Path(tmp) / "knowledge")
        object_ids = seed_knowledge_drafts(obj_store)
        seed = load_knowledge_seed()
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
        nb = gstore.neighborhood("metric-east-gmv", depth=1, limit=50)
        evidence["steps"]["A4_publish_neighborhood"] = {
            "stats_ok": stats["ok"],
            "entities": stats["entities_upserted"],
            "relations": stats["relations_upserted"],
            "node_ids": [n["id"] for n in nb["nodes"]],
            "edge_ids": [e["id"] for e in nb["edges"]],
            "ok": "metric-east-gmv" in {n["id"] for n in nb["nodes"]}
            and "rel-gmv-depends-orders" in {e["id"] for e in nb["edges"]},
        }
        evidence["steps"]["A5_secondary_warning"] = {
            "ok_flag": stats["ok"],
            "warnings": stats["warnings"],
            "primary_failures": stats["primary_failures"],
            "ok": stats["ok"] is True
            and bool(stats["warnings"])
            and any("secondary_hook_failed:" in w for w in stats["warnings"]),
        }

    out = OUT / "api-cli-closed-loop.json"
    out.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(out)
    failed = [k for k, v in evidence["steps"].items() if not v.get("ok")]
    if failed:
        raise SystemExit(f"failed steps: {failed}")


if __name__ == "__main__":
    main()
