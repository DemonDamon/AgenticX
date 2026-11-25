"""OKF 导出单元测试：round-trip 保真、目录恢复、最小 frontmatter 生成。"""

from __future__ import annotations

import asyncio

from agenticx.knowledge.document import Document, DocumentMetadata
from agenticx.knowledge.okf_export import export_bundle, EXPORT_ACTOR
from agenticx.knowledge.readers.okf_reader import OKFReader, OKF_METADATA_KEY

# 复用 reader 测试的 fixture 内容，保证两端面对同一 Bundle 语义
from tests.okf_reader_test import (
    CONCEPT_TABLES_ORDERS,
    CONCEPT_METRICS_WAU,
    _write_bundle,
)

GENERATED_KEYS = {"by", "at"}


def _read(tmp_path):
    reader = OKFReader()
    return asyncio.run(reader.read(tmp_path))


def test_round_trip_preserves_frontmatter_and_structure(tmp_path):
    """读入 → 导出 → 再读入：字段值等价、未知字段保留、目录结构恢复。"""
    _write_bundle(tmp_path)
    original = _read(tmp_path)

    out_dir = tmp_path / "exported"
    written = export_bundle(original, out_dir)
    assert len(written) == len(original)

    # 目录结构按 concept_id 恢复
    assert (out_dir / "tables" / "orders.md").is_file()
    assert (out_dir / "metrics" / "weekly_active_users.md").is_file()
    assert (out_dir / "misc" / "plain.md").is_file()

    # 再读入，逐 concept 对照
    reloaded = _read(out_dir)
    by_id = {
        doc.metadata.custom[OKF_METADATA_KEY]["concept_id"]: doc for doc in reloaded
    }

    orders_orig = next(
        doc for doc in original
        if doc.metadata.custom[OKF_METADATA_KEY]["concept_id"] == "tables/orders"
    )
    orders = by_id["tables/orders"]
    okf_orig = orders_orig.metadata.custom[OKF_METADATA_KEY]
    okf_re = orders.metadata.custom[OKF_METADATA_KEY]

    # 字段值等价（generated 因记录导出动作允许变化）
    assert okf_re["type"] == okf_orig["type"]
    assert okf_re["title"] == okf_orig["title"]
    assert okf_re["resource"] == okf_orig["resource"]
    assert okf_re["tags"] == okf_orig["tags"]
    assert okf_re["owner"] == okf_orig["owner"]
    assert okf_re["pii"] == okf_orig["pii"]
    assert okf_re["status"] == okf_orig["status"]
    assert okf_re["stale_after"] == okf_orig["stale_after"]
    assert okf_re["sources"] == okf_orig["sources"]
    assert okf_re["verified"] == okf_orig["verified"]
    # 未知字段（owner/pii）在往返后不丢失
    assert "owner" in okf_re and "pii" in okf_re
    # 导出动作记入 generated（Actor 命名约定）
    assert okf_re["generated"]["by"] == EXPORT_ACTOR
    assert "at" in okf_re["generated"]
    # 时间戳保持字符串形态（round-trip 无类型漂移）
    assert isinstance(okf_re["stale_after"], str)
    # 正文保真
    assert orders.content.strip() == orders_orig.content.strip()


def test_round_trip_degraded_documents_stay_readable(tmp_path):
    """降级文档（坏 YAML / 无 frontmatter）导出后再读入仍是合法 Concept。"""
    _write_bundle(tmp_path)
    original = _read(tmp_path)

    out_dir = tmp_path / "exported2"
    export_bundle(original, out_dir)
    reloaded = _read(out_dir)
    by_id = {
        doc.metadata.custom[OKF_METADATA_KEY]["concept_id"]: doc for doc in reloaded
    }

    # 坏 YAML 文档经导出修复为最小合法 frontmatter（type: Reference）
    bad = by_id["misc/bad_yaml"]
    assert bad.metadata.custom[OKF_METADATA_KEY]["type"] == "Reference"
    assert "正文不受影响" in bad.content

    # 无 frontmatter 文档同样获得最小 frontmatter，正文保真
    plain = by_id["misc/plain"]
    assert plain.metadata.custom[OKF_METADATA_KEY]["type"] == "Reference"
    assert "没有 frontmatter 的 Markdown 正文" in plain.content


def test_concept_id_not_leaked_into_frontmatter(tmp_path):
    """concept_id 是 reader 内部注入键，导出时不得写进 frontmatter。"""
    _write_bundle(tmp_path)
    original = _read(tmp_path)

    out_dir = tmp_path / "exported3"
    export_bundle(original, out_dir)

    orders_file = (out_dir / "tables" / "orders.md").read_text(encoding="utf-8")
    assert "concept_id" not in orders_file.split("---")[1]


def test_documents_without_okf_metadata_get_minimal_frontmatter(tmp_path):
    """裸 Document（无 okf 元数据）导出为最小合法 Concept。"""
    doc = Document(
        content="运维手册正文。",
        metadata=DocumentMetadata(name="ops-runbook"),
    )
    out_dir = tmp_path / "exported4"
    written = export_bundle([doc], out_dir)

    assert written == [out_dir / "ops-runbook.md"]
    text = written[0].read_text(encoding="utf-8")
    assert "type: Reference" in text
    assert f"by: {EXPORT_ACTOR}" in text
    assert "运维手册正文" in text

    # 再读入可解析为合法 Concept
    reloaded = asyncio.run(OKFReader().read(out_dir))
    assert len(reloaded) == 1
    okf = reloaded[0].metadata.custom[OKF_METADATA_KEY]
    assert okf["type"] == "Reference"
    assert okf["concept_id"] == "ops-runbook"


def test_unnamed_and_duplicate_documents(tmp_path):
    """无名文档回退序号；重复 concept_id 追加去重不覆盖。"""
    docs = [
        Document(content="A", metadata=DocumentMetadata(name="same")),
        Document(content="B", metadata=DocumentMetadata(name="same")),
        Document(content="C", metadata=DocumentMetadata()),
    ]
    out_dir = tmp_path / "exported5"
    written = export_bundle(docs, out_dir)

    assert len(written) == 3
    assert written[0].read_text(encoding="utf-8").split("\n")[0] == "---"
    assert (out_dir / "same~1.md").is_file()
    assert (out_dir / "_unnamed-2.md").is_file()
    # 两个同名文件内容各自保留，未互相覆盖
    assert "A" in written[0].read_text(encoding="utf-8")
    assert "B" in written[1].read_text(encoding="utf-8")
    assert "C" in written[2].read_text(encoding="utf-8")


def test_path_traversal_concept_id_is_rejected(tmp_path):
    """非法 concept_id（路径穿越 / 绝对路径）不得写出 Bundle 之外。"""
    doc = Document(
        content="evil",
        metadata=DocumentMetadata(
            name="../../etc/passwd",
            custom={OKF_METADATA_KEY: {"concept_id": "../../escape", "type": "Table"}},
        ),
    )
    out_dir = tmp_path / "exported6"
    written = export_bundle([doc], out_dir)

    # concept_id 与 name 均非法 → 回退序号，全部落在 output_dir 内
    assert written == [out_dir / "_unnamed-0.md"]
    # 没有任何文件写出 Bundle 目录之外
    assert list(out_dir.rglob("*.md")) == [out_dir / "_unnamed-0.md"]
    assert not list(tmp_path.glob("../*escape*"))
