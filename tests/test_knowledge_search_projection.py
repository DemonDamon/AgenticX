"""knowledge_search projection keeps every hit instead of cutting the JSON middle."""

from __future__ import annotations

import json

from agenticx.runtime.compactor import ContextCompactor


class _Resp:
    def __init__(self, content: str) -> None:
        self.content = content


class _LLM:
    def invoke(self, *_args, **_kwargs):
        return _Resp("摘要")


def _hit(hit_id: str, text: str, *, wiki: str = "") -> dict:
    item = {
        "id": hit_id,
        "score": 0.55,
        "text": text,
        "source": {
            "kind": "local",
            "uri": "/docs/" + ("x" * 180) + ".pdf",
            "title": "讲义.pdf",
            "chunk_index": 1,
        },
        "metadata": {
            "vector_score": 0.55,
            "bm25_score": 0.0,
            "fused_score": 0.55,
            "retrieval_mode": "vector",
            "source_path": "/docs/" + ("y" * 180) + ".pdf",
        },
        "vector_score": 0.55,
        "bm25_score": 0.0,
        "fused_score": 0.55,
        "retrieval_mode": "vector",
        "brain_id": "default_docs",
        "brain_name": "默认文档库",
    }
    if wiki:
        item["metadata"]["wiki_page"] = wiki
        item["source"]["title"] = "三大Ontology对比"
    return item


def test_middle_hit_steps_survive_projection() -> None:
    page48 = (
        "--- Page 48 ---\n火龙果讲堂\n \n \n \numl.lorg.cn\n"
        + ("步" * 400)
        + "创建动作\n输入：“评估后自动调度资源”等规则。\n"
        + "老刘说NLP 刘焕勇\n"
    )
    assert "调度资源" in page48
    hits = [
        _hit("chunk-55", "第55页 业务大脑 " + ("甲" * 500)),
        _hit("chunk-53", "第53页 OWL 学术 " + ("乙" * 500)),
        _hit("chunk-48", page48),
        _hit("chunk-51", "第51页 语义笼子 " + ("丙" * 500)),
        _hit("chunk-52", "第52页 五大流派 " + ("丁" * 500)),
        _hit("wiki-onto", "Palantir 以业务为中心，函数计算 + Action。" + ("戊" * 200), wiki="wiki/三大Ontology对比.md"),
    ]
    raw = json.dumps(
        {
            "ok": True,
            "hits": hits,
            "by_brain": [{"brain_id": "default_docs", "hits": hits}],
            "used_top_k": 6,
            "source": "local",
            "brains": ["default_docs"],
        },
        ensure_ascii=False,
    )
    assert len(raw) > 4000

    out = ContextCompactor(_LLM()).micro_compact_tool_result(
        "knowledge_search", raw, budget=4000
    )
    assert "truncated" not in out
    assert "by_brain" not in out
    assert len(out) <= 4000
    payload = json.loads(out)
    ids = [hit["id"] for hit in payload["hits"]]
    assert ids == ["chunk-55", "chunk-53", "chunk-48", "chunk-51", "chunk-52", "wiki-onto"]
    assert "创建动作" in payload["hits"][2]["text"]
    assert "调度资源" in payload["hits"][2]["text"]
    assert "火龙果讲堂" not in payload["hits"][2]["text"]
    assert "老刘说NLP" not in payload["hits"][2]["text"]
    assert payload["hits"][-1]["wiki_page"] == "wiki/三大Ontology对比.md"
    assert "vector_score" not in payload["hits"][0]


def test_short_knowledge_search_payload_is_unchanged() -> None:
    raw = json.dumps({"ok": True, "hits": [_hit("only", "短")], "by_brain": []}, ensure_ascii=False)
    out = ContextCompactor(_LLM()).micro_compact_tool_result(
        "knowledge_search", raw, budget=4000
    )
    assert out == raw


def test_non_json_knowledge_search_still_uses_head_tail() -> None:
    raw = "不是 JSON " + ("字" * 5000)
    out = ContextCompactor(_LLM()).micro_compact_tool_result(
        "knowledge_search", raw, budget=400
    )
    assert "truncated" in out


def test_other_tools_keep_head_tail_truncation() -> None:
    raw = "x" * 5000
    out = ContextCompactor(_LLM()).micro_compact_tool_result("file_read", raw, budget=400)
    assert "truncated" in out
    assert not out.startswith("{")
