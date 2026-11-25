"""OKFReader 单元测试：Bundle 解析、字段映射、保留文件跳过、宽容降级。"""

from __future__ import annotations

import asyncio

import pytest

from agenticx.knowledge.readers import get_reader, READER_REGISTRY
from agenticx.knowledge.readers.okf_reader import OKFReader, OKF_METADATA_KEY

CONCEPT_TABLES_ORDERS = """---
type: BigQuery Table
title: Orders
description: 一行对应一笔已完成的客户订单。
resource: bigquery://project/dataset/orders
tags: [sales, orders]
owner: data-platform
pii: true
generated:
  by: reference_agent/gemini-flash-latest
  at: 2026-07-24T10:00:00Z
sources:
  - id: bq-orders
    resource: bigquery://project/dataset/orders
    author: data-platform
    last_modified: 2026-07-20T08:30:00Z
verified:
  - by: human:liziran
    at: 2026-07-25T09:12:00Z
status: stable
stale_after: 2026-12-31T23:59:59Z
---

# Schema

| Column | Type | Description |
| --- | --- | --- |
| order_id | STRING | 全局唯一订单标识 |

通过 `customer_id` 与 [customers](/tables/customers.md) 关联。
"""

CONCEPT_METRICS_WAU = """---
type: Metric
title: Weekly Active Users
tags: [metric, growth]
status: draft
stale_after: 2026-10-01T00:00:00Z
---

# Computation

周活跃用户数，按去重用户 ID 统计。
"""

CONCEPT_DAILY_ETL = """---
type: Attested Computation
title: Daily ETL Check
runtime: bash
parameters:
  window: 24h
computation: etl_check.sh
executor: process:daily-etl
attester: verify://internal/etl
status: deprecated
---

# Computation

每日 ETL 一致性校验，已废弃。
"""

BAD_YAML_FILE = """---
type: [unclosed
  bad yaml :::
---

正文不受影响。
"""

NO_FRONTMATTER_FILE = """# 普通文档

没有 frontmatter 的 Markdown 正文。
"""


def _write_bundle(root):
    """构造完整 fixture Bundle：嵌套目录 + 保留文件 + 坏/无 frontmatter 文件。"""
    (root / "index.md").write_text(
        "* [orders](tables/orders.md) - 订单表\n* [customers](tables/customers.md) - 客户表\n",
        encoding="utf-8",
    )
    (root / "log.md").write_text(
        "## 2026-11-25\n\n- 初始化 Bundle\n",
        encoding="utf-8",
    )
    tables = root / "tables"
    tables.mkdir()
    (tables / "orders.md").write_text(CONCEPT_TABLES_ORDERS, encoding="utf-8")
    (tables / "customers.md").write_text(
        "---\ntype: Table\ntitle: Customers\n---\n\n客户主数据。\n",
        encoding="utf-8",
    )
    metrics = root / "metrics"
    metrics.mkdir()
    (metrics / "weekly_active_users.md").write_text(CONCEPT_METRICS_WAU, encoding="utf-8")
    (metrics / "daily_etl.md").write_text(CONCEPT_DAILY_ETL, encoding="utf-8")
    misc = root / "misc"
    misc.mkdir()
    (misc / "bad_yaml.md").write_text(BAD_YAML_FILE, encoding="utf-8")
    (misc / "plain.md").write_text(NO_FRONTMATTER_FILE, encoding="utf-8")


def _run(coro):
    return asyncio.run(coro)


def test_okf_reader_registered():
    assert READER_REGISTRY.get("okf") is OKFReader
    reader = get_reader("whatever/path.md", reader_name="okf")
    assert isinstance(reader, OKFReader)


def test_bundle_mode_parses_concepts_and_skips_reserved_files(tmp_path):
    _write_bundle(tmp_path)
    reader = OKFReader()
    documents = _run(reader.read(tmp_path))

    # 8 个 .md 中：index/log 跳过；tables/orders、tables/customers、
    # metrics/weekly_active_users、metrics/daily_etl、misc/bad_yaml、misc/plain 共 6 个
    assert len(documents) == 6
    concept_ids = {doc.metadata.custom[OKF_METADATA_KEY]["concept_id"] for doc in documents}
    assert "tables/orders" in concept_ids
    assert "tables/customers" in concept_ids
    assert "metrics/weekly_active_users" in concept_ids
    assert "misc/plain" in concept_ids
    # 保留文件不能作为 Concept
    assert "index" not in concept_ids
    assert "log" not in concept_ids


def test_field_mapping_orders_concept(tmp_path):
    _write_bundle(tmp_path)
    reader = OKFReader()
    documents = _run(reader.read(tmp_path))
    orders = next(
        doc for doc in documents
        if doc.metadata.custom[OKF_METADATA_KEY]["concept_id"] == "tables/orders"
    )

    okf = orders.metadata.custom[OKF_METADATA_KEY]
    # title→name、tags→tags
    assert orders.metadata.name == "Orders"
    assert orders.metadata.tags == ["sales", "orders"]
    # 关键字段族原样保留在 custom["okf"]
    assert okf["type"] == "BigQuery Table"
    assert okf["resource"] == "bigquery://project/dataset/orders"
    assert okf["status"] == "stable"
    assert okf["stale_after"] == "2026-12-31T23:59:59Z"
    assert okf["generated"]["by"] == "reference_agent/gemini-flash-latest"
    assert okf["verified"][0]["by"] == "human:liziran"
    assert okf["sources"][0]["id"] == "bq-orders"
    # 未知字段原样保留（round-trip 保真）
    assert okf["owner"] == "data-platform"
    assert okf["pii"] is True
    # 正文 = frontmatter 之后的 body
    assert "# Schema" in orders.content
    assert "order_id|STRING" in orders.content.replace(" ", "")


def test_lifecycle_and_computation_fields_preserved(tmp_path):
    _write_bundle(tmp_path)
    reader = OKFReader()
    documents = _run(reader.read(tmp_path))

    wau = next(
        doc for doc in documents
        if doc.metadata.custom[OKF_METADATA_KEY]["concept_id"] == "metrics/weekly_active_users"
    )
    assert wau.metadata.custom[OKF_METADATA_KEY]["status"] == "draft"
    assert wau.metadata.tags == ["metric", "growth"]

    etl = next(
        doc for doc in documents
        if doc.metadata.custom[OKF_METADATA_KEY]["concept_id"] == "metrics/daily_etl"
    )
    etl_okf = etl.metadata.custom[OKF_METADATA_KEY]
    assert etl_okf["status"] == "deprecated"
    assert etl_okf["executor"] == "process:daily-etl"
    assert etl_okf["parameters"]["window"] == "24h"


def test_bad_yaml_degrades_to_plain_text(tmp_path):
    _write_bundle(tmp_path)
    reader = OKFReader()
    documents = _run(reader.read(tmp_path))
    bad = next(
        doc for doc in documents
        if doc.metadata.custom[OKF_METADATA_KEY]["concept_id"] == "misc/bad_yaml"
    )
    # 降级不抛错；正文完整保留；custom["okf"] 仅含 concept_id
    assert "正文不受影响" in bad.content
    assert set(bad.metadata.custom[OKF_METADATA_KEY].keys()) == {"concept_id"}


def test_no_frontmatter_degrades(tmp_path):
    _write_bundle(tmp_path)
    reader = OKFReader()
    documents = _run(reader.read(tmp_path))
    plain = next(
        doc for doc in documents
        if doc.metadata.custom[OKF_METADATA_KEY]["concept_id"] == "misc/plain"
    )
    assert "没有 frontmatter 的 Markdown 正文" in plain.content
    assert plain.metadata.name == "misc/plain"


def test_single_file_mode(tmp_path):
    _write_bundle(tmp_path)
    reader = OKFReader()
    # 单文件模式：concept_id 退化为文件名
    documents = _run(reader.read(tmp_path / "tables" / "orders.md"))
    assert len(documents) == 1
    okf = documents[0].metadata.custom[OKF_METADATA_KEY]
    assert okf["concept_id"] == "orders"
    assert okf["type"] == "BigQuery Table"

    # 保留文件单文件模式返回空
    assert _run(reader.read(tmp_path / "index.md")) == []
    assert _run(reader.read(tmp_path / "log.md")) == []


def test_read_async_yields_all_concepts(tmp_path):
    _write_bundle(tmp_path)
    reader = OKFReader()

    async def collect():
        return [doc async for doc in reader.read_async(tmp_path)]

    documents = _run(collect())
    assert len(documents) == 6


def test_missing_path_raises(tmp_path):
    reader = OKFReader()
    with pytest.raises(FileNotFoundError):
        _run(reader.read(tmp_path / "nonexistent"))
