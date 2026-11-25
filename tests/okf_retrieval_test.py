"""FR3 — OKF 概念进入 KnowledgeBase 后的元数据过滤召回通路验证。

后端 Mock 与真实 VectorDBMemory 同语义：metadata_filter 顶层键精确匹配
（camel_memories.py::_matches_metadata_filter），证明 OKF 元数据经平铺桥接后
可被现有检索链路直接过滤，检索侧零改动。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from agenticx.knowledge.document import Document
from agenticx.memory.base import BaseMemory, MemoryRecord, SearchResult
from agenticx.memory.knowledge_base import KnowledgeBase
from agenticx.knowledge.okf_export import export_bundle
from agenticx.knowledge.readers.okf_reader import OKFReader, OKF_METADATA_KEY

from tests.okf_reader_test import _write_bundle


class InMemoryMemoryBackend(BaseMemory):
    """内存版 BaseMemory：关键词重叠打分 + metadata_filter 顶层精确匹配。

    匹配语义与 camel_memories.py::_matches_metadata_filter 保持一致，
    用于验证通路而非复刻实现。
    """

    def __init__(self, tenant_id: str = "_default_"):
        super().__init__(tenant_id)
        self._records: Dict[str, MemoryRecord] = {}

    async def add(self, content: str, metadata: Optional[Dict[str, Any]] = None,
                  record_id: Optional[str] = None) -> str:
        record_id = record_id or str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        self._records[record_id] = MemoryRecord(
            id=record_id,
            content=content,
            metadata=metadata or {},
            tenant_id=self.tenant_id,
            created_at=now,
            updated_at=now,
        )
        return record_id

    async def search(self, query: str, limit: int = 10,
                     metadata_filter: Optional[Dict[str, Any]] = None,
                     min_score: float = 0.0) -> List[SearchResult]:
        query_words = query.lower().split()
        scored = []
        for record in self._records.values():
            if metadata_filter:
                if any(
                    record.metadata.get(k) != v
                    for k, v in metadata_filter.items()
                ):
                    continue
            content_lower = record.content.lower()
            if query_words:
                score = sum(1 for w in query_words if w in content_lower) / len(query_words)
            else:
                score = 1.0
            if score >= min_score:
                scored.append(SearchResult(record=record, score=score))
        scored.sort(key=lambda s: s.score, reverse=True)
        return scored[:limit]

    async def update(self, record_id: str, content: Optional[str] = None,
                     metadata: Optional[Dict[str, Any]] = None) -> bool:
        record = self._records.get(record_id)
        if record is None:
            return False
        if content is not None:
            record.content = content
        if metadata is not None:
            record.metadata.update(metadata)
        record.updated_at = datetime.now(timezone.utc)
        return True

    async def delete(self, record_id: str) -> bool:
        return self._records.pop(record_id, None) is not None

    async def get(self, record_id: str) -> Optional[MemoryRecord]:
        return self._records.get(record_id)

    async def list_all(self, limit: int = 100, offset: int = 0,
                       metadata_filter: Optional[Dict[str, Any]] = None) -> List[MemoryRecord]:
        records = list(self._records.values())
        if metadata_filter:
            records = [
                r for r in records
                if all(r.metadata.get(k) == v for k, v in metadata_filter.items())
            ]
        return records[offset:offset + limit]

    async def clear(self) -> int:
        count = len(self._records)
        self._records.clear()
        return count


# OKF frontmatter 键 → KB metadata 平铺键（真实语义：顶层键精确匹配）
_FLATTEN_RULES = {
    "type": "okf_type",
    "status": "okf_status",
    "stale_after": "okf_stale_after",
    "concept_id": "okf_concept_id",
    "resource": "okf_resource",
}


def add_okf_concepts_to_kb(documents: List[Document], kb: KnowledgeBase) -> List[str]:
    """桥接：OKF Document → KnowledgeBase（frontmatter 关键键平铺到 metadata 顶层）。"""
    record_ids = []
    for doc in documents:
        okf = doc.metadata.custom.get(OKF_METADATA_KEY, {})
        metadata = {flat: okf[orig] for orig, flat in _FLATTEN_RULES.items() if okf.get(orig)}
        record_ids.append(
            asyncio.run(
                kb.add(
                    content=doc.content,
                    metadata=metadata,
                    content_type=okf.get("type", "Reference"),
                )
            )
        )
    return record_ids


def _load_kb_with_bundle(tmp_path, kb_name="okf-poc"):
    documents = asyncio.run(OKFReader().read(tmp_path))
    kb = KnowledgeBase(kb_name, memory_backend=InMemoryMemoryBackend())
    add_okf_concepts_to_kb(documents, kb)
    return kb, documents


def test_okf_metadata_filter_excludes_draft_and_deprecated(tmp_path):
    """metadata_filter 按 okf_status 过滤：stable 召回，draft/deprecated 排除。"""
    _write_bundle(tmp_path)
    kb, _ = _load_kb_with_bundle(tmp_path)

    results = asyncio.run(
        kb.search(query="订单", limit=10, metadata_filter={"okf_status": "stable"})
    )
    assert results
    statuses = {r.record.metadata["okf_status"] for r in results}
    assert statuses == {"stable"}
    concept_ids = {r.record.metadata["okf_concept_id"] for r in results}
    assert "tables/orders" in concept_ids
    # draft（weekly_active_users）与 deprecated（daily_etl）被挡在召回外
    assert "metrics/weekly_active_users" not in concept_ids
    assert "metrics/daily_etl" not in concept_ids


def test_okf_type_filter_and_content_type_channel(tmp_path):
    """okf_type 平铺过滤 + KB 原生 content_type 通道均可用。"""
    _write_bundle(tmp_path)
    kb, _ = _load_kb_with_bundle(tmp_path)

    by_type = asyncio.run(
        kb.search(query="数据", limit=10, metadata_filter={"okf_type": "BigQuery Table"})
    )
    assert {r.record.metadata["okf_concept_id"] for r in by_type} == {"tables/orders"}

    by_content_type = asyncio.run(
        kb.search(query="数据", limit=10, content_type="BigQuery Table")
    )
    assert {r.record.metadata["okf_concept_id"] for r in by_content_type} == {"tables/orders"}


def test_stale_after_is_consumer_visible(tmp_path):
    """stale_after 元数据对消费方可见：过期知识可在召回后排除（不改检索语义）。"""
    _write_bundle(tmp_path)
    kb, _ = _load_kb_with_bundle(tmp_path)

    results = asyncio.run(kb.search(query="活跃 用户 指标", limit=10))
    now = datetime.now(timezone.utc)
    fresh, stale = [], []
    for r in results:
        raw = r.record.metadata.get("okf_stale_after")
        if not raw:
            continue
        deadline = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        (fresh if deadline > now else stale).append(r.record.metadata["okf_concept_id"])
    # weekly_active_users 的 stale_after=2026-10-01 已过期，可被确定性排除
    assert "metrics/weekly_active_users" in stale


def test_end_to_end_bundle_to_kb_to_export_round_trip(tmp_path):
    """端到端：Bundle → OKFReader → KnowledgeBase → 召回 → export → 再读入 diff。"""
    _write_bundle(tmp_path)
    kb, documents = _load_kb_with_bundle(tmp_path)

    # 召回 stable 概念并导出
    results = asyncio.run(
        kb.search(query="订单 客户", limit=10, metadata_filter={"okf_status": "stable"})
    )
    assert results

    out_dir = tmp_path / "exported"
    written = export_bundle(documents, out_dir)
    assert (out_dir / "tables" / "orders.md").is_file()

    # 再读入校验概念完整
    reloaded = asyncio.run(OKFReader().read(out_dir))
    assert len(reloaded) == len(documents)
