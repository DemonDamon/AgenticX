"""华东零售复杂案例 — API 级夹具与编排助手（无客户 B-pack）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from agenticx.knowledge.lifecycle.model import KnowledgeObject
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore
from agenticx.managed.llm import LLMCallContext
from agenticx.managed.templates.data_suite import FakeQueryChannel
from agenticx.managed.testing import ScriptStep, ScriptedLLM, StaticLLMFactory

CASE_NAME = "华东零售 · 月度经营问数 + 知识图核验"
CASE_QUESTION = "上月华东大区 GMV 和退货率分别是多少？"
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "east_china_retail"


def load_channel_seed() -> Dict[str, Any]:
    return json.loads((FIXTURE_DIR / "channel_seed.json").read_text(encoding="utf-8"))


def load_knowledge_seed() -> Dict[str, Any]:
    return json.loads((FIXTURE_DIR / "knowledge_objects.json").read_text(encoding="utf-8"))


def build_fake_channel() -> Tuple[FakeQueryChannel, str, List[dict]]:
    """In-memory/fake channel with Chinese monthly-ops rows."""
    seed = load_channel_seed()
    rows = list(seed["rows"])
    sql = str(seed["scripted_sql"])
    return FakeQueryChannel(rows), sql, rows


def build_scripted_nl2sql_factory(scripted_sql: str) -> StaticLLMFactory:
    """Hermetic LLM that always drafts the case SQL (no live model)."""
    llm = ScriptedLLM(
        [ScriptStep(content=f"```sql\n{scripted_sql}\n```")],
    )
    return StaticLLMFactory(llm)


def case_llm_context() -> LLMCallContext:
    return LLMCallContext(
        tenant_id="east-china-retail-demo",
        session_id="w5-complex-case",
        agent_id="nl2sql-east-china",
        agent_version=1,
        user_id="demo-ops",
    )


def seed_knowledge_drafts(store: KnowledgeObjectFileStore) -> List[str]:
    """Upsert Chinese knowledge drafts (≥2 entities + ≥1 relationship)."""
    payload = load_knowledge_seed()
    ids: List[str] = []
    for raw in payload["objects"]:
        obj = KnowledgeObject(
            id=str(raw["id"]),
            kind=str(raw["kind"]),
            attrs=dict(raw.get("attrs") or {}),
            relations=[dict(r) for r in (raw.get("relations") or [])],
            source_ids=[str(x) for x in (raw.get("source_ids") or [])],
            meta=dict(raw.get("meta") or {}),
        )
        store.upsert_object(obj)
        ids.append(obj.id)
    return ids


__all__ = [
    "CASE_NAME",
    "CASE_QUESTION",
    "FIXTURE_DIR",
    "build_fake_channel",
    "build_scripted_nl2sql_factory",
    "case_llm_context",
    "load_channel_seed",
    "load_knowledge_seed",
    "seed_knowledge_drafts",
]
