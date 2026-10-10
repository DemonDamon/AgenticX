#!/usr/bin/env python3
"""SP31: incremental brain wiki compilation.

Verifies the three product-visible behaviors of the upgraded
`WikiCompiler.compile_source`:
1. unchanged source documents skip the LLM entirely (queue "skipped" status)
2. cross-document pages MERGE — both documents' claims + sources survive,
   LLM-surfaced 矛盾 sections survive
3. legacy pages not owned by the compiling document are never touched

The LLM is mocked at `_invoke_llm_cancellable` — no network, deterministic.
"""

from __future__ import annotations
import json
from pathlib import Path

import pytest

from agenticx.brain.wiki_compiler import (
    WikiCompiler,
    WikiCompileResult,
    parse_file_blocks,
)
from agenticx.brain import wiki_compiler as wc_mod


class _LLMMock:
    def __init__(self, generation: str):
        self.generation = generation
        self.calls = 0

    def __call__(self, messages, **_kw):
        self.calls += 1
        # The two calls differ in their USER message content.
        if "生成 wiki 文件块" in messages[-1]["content"]:
            return self.generation
        return json.dumps({"entities": [], "concepts": [], "contradictions": []})


def _page_block(path: str, title: str, claims: list[str], sources: list[str],
                contradictions: list[str] | None = None,
                ptype: str = "concept", desc: str = "一句话") -> str:
    lines = [f"---\ntitle: {title}\ntype: {ptype}\ndescription: {desc}\n"
             f"sources:"]
    lines += [f"  - {s}" for s in sources]
    lines += [f"---\n\n# {title}\n\n{desc}\n\n## 要点\n"]
    lines += [f"- {c}" for c in claims]
    if contradictions:
        lines += ["", "## 矛盾", ""]
        lines += [f"- {c}" for c in contradictions]
    body = "\n".join(lines)
    return f"===FILE: {path} ===\n{body}\n"


@pytest.fixture
def storage(tmp_path):
    WikiCompiler(tmp_path)          # initializes wiki root + purpose/schema
    return tmp_path


def _compile(storage, source_path, generation, calls_box, source_text="doc body"):
    mock = _LLMMock(generation)
    calls_box.append(mock)

    def _fake(messages, **kw):
        return mock(messages, **kw)

    monkey = pytest.MonkeyPatch()
    monkey.setattr(wc_mod, "_invoke_llm_cancellable", _fake)
    try:
        compiler = WikiCompiler(storage)
        return compiler.compile_source(
            source_path=source_path, source_text=source_text,
            provider_name="p", model_name="m")
    finally:
        monkey.undo()


# ---------------------------------------------------------------------------
# 1. Unchanged-document skip
# ---------------------------------------------------------------------------

def test_unchanged_document_skips_llm_entirely(storage):
    calls = []
    gen = _page_block("wiki/concepts/rule.md", "Rule",
                      ["Rule applies to all.（来源: a.pdf）"], ["a.pdf"])
    r1 = _compile(storage, "/docs/a.pdf", gen, calls, source_text="AAA")
    assert r1.ok and r1.written == ["wiki/concepts/rule.md"]
    assert calls[0].calls == 2                     # analysis + generation

    r2 = _compile(storage, "/docs/a.pdf", gen, calls, source_text="AAA")
    assert r2.ok and r2.written == []
    assert r2.skipped_reason == "源文档未变化，跳过编译"
    assert calls[1].calls == 0                     # ZERO further LLM calls


def test_changed_document_recompiles(storage):
    calls = []
    gen = _page_block("wiki/concepts/rule.md", "Rule",
                      ["Rule applies.（来源: a.pdf）"], ["a.pdf"])
    _compile(storage, "/docs/a.pdf", gen, calls, source_text="AAA")
    r2 = _compile(storage, "/docs/a.pdf", gen, calls, source_text="BBB")
    assert r2.ok and r2.written == ["wiki/concepts/rule.md"]
    assert calls[1].calls == 2


# ---------------------------------------------------------------------------
# 2. Cross-document merge
# ---------------------------------------------------------------------------

def test_cross_document_claims_and_sources_merge(storage):
    calls = []
    gen_a = _page_block("wiki/entities/acme.md", "Acme",
                        ["Acme was founded in 2020.（来源: a.pdf）"], ["a.pdf"],
                        ptype="entity")
    r1 = _compile(storage, "/docs/a.pdf", gen_a, calls, source_text="A")
    assert r1.written == ["wiki/entities/acme.md"]

    gen_b = _page_block("wiki/entities/acme.md", "Acme",
                        ["Acme serves enterprise customers.（来源: b.pdf）",
                         "Acme was founded in 2020.（来源: b.pdf）"],
                        ["b.pdf"], ptype="entity")
    r2 = _compile(storage, "/docs/b.pdf", gen_b, calls, source_text="B")
    assert r2.ok and r2.written == ["wiki/entities/acme.md"]

    page = (storage / "wiki" / "entities" / "acme.md").read_text(encoding="utf-8")
    # Both documents' claims survive the second compile.
    assert "founded in 2020" in page
    assert "enterprise customers" in page
    # The duplicate claim merged its provenance (a.pdf + b.pdf).
    assert "（来源: a.pdf, b.pdf）" in page
    # Frontmatter sources is the union.
    assert "  - a.pdf" in page and "  - b.pdf" in page


def test_same_doc_recompile_can_rewrite_owned_page(storage):
    calls = []
    gen_a = _page_block("wiki/concepts/rule.md", "Rule",
                        ["Old claim v1.（来源: a.pdf）"], ["a.pdf"])
    _compile(storage, "/docs/a.pdf", gen_a, calls, source_text="A")

    gen_a2 = _page_block("wiki/concepts/rule.md", "Rule",
                         ["New claim v2.（来源: a.pdf）"], ["a.pdf"])
    r2 = _compile(storage, "/docs/a.pdf", gen_a2, calls, source_text="A-v2")
    assert r2.written == ["wiki/concepts/rule.md"]
    page = (storage / "wiki" / "concepts" / "rule.md").read_text(encoding="utf-8")
    assert "New claim v2" in page
    assert "Old claim v1" in page      # merge keeps it (same doc, merge path)
    assert "（来源: a.pdf, a.pdf）" not in page


def test_contradiction_section_survives_cross_doc_merge(storage):
    calls = []
    gen_a = _page_block("wiki/analysis/refund.md", "Refund",
                        ["Uninsured pay 1x freight.（来源: policy-v1.pdf）"],
                        ["policy-v1.pdf"], ptype="analysis")
    _compile(storage, "/docs/policy-v1.pdf", gen_a, calls, source_text="A")

    gen_b = _page_block(
        "wiki/analysis/refund.md", "Refund",
        ["Refunds need approval.（来源: policy-v2.pdf）"],
        ["policy-v2.pdf"], ptype="analysis",
        contradictions=[
            "A: Uninsured pay 1x freight.（来源: policy-v1.pdf）",
            "B: Uninsured pay 3x base freight.（来源: policy-v2.pdf）",
        ])
    r2 = _compile(storage, "/docs/policy-v2.pdf", gen_b, calls, source_text="B")
    assert r2.ok
    page = (storage / "wiki" / "analysis" / "refund.md").read_text(encoding="utf-8")
    assert "## 矛盾" in page
    assert "1x freight" in page and "3x base freight" in page
    assert "policy-v1.pdf" in page and "policy-v2.pdf" in page
    # Re-parse round-trip: the merged page is itself structured.
    from agenticx.brain.wiki.page import WikiPage
    parsed = WikiPage.parse(page, source_path="wiki/analysis/refund.md")
    assert parsed.status == "contradicted"
    assert len(parsed.claims) >= 2
    assert len(parsed.contradiction_claims) == 2


# ---------------------------------------------------------------------------
# 3. Legacy pages are never destroyed
# ---------------------------------------------------------------------------

def test_legacy_unowned_page_preserved_byte_identical(storage):
    legacy_path = storage / "wiki" / "concepts" / "handwritten.md"
    legacy_path.parent.mkdir(parents=True, exist_ok=True)
    legacy_body = "# 手写页\n\n没有 frontmatter 的历史页面，不允许被编译覆盖。\n"
    legacy_path.write_text(legacy_body, encoding="utf-8")
    before = legacy_path.read_bytes()

    calls = []
    gen = _page_block("wiki/concepts/handwritten.md", "handwritten",
                      ["New claim.（来源: a.pdf）"], ["a.pdf"])
    r = _compile(storage, "/docs/a.pdf", gen, calls, source_text="A")
    assert r.ok
    assert r.skipped == ["wiki/concepts/handwritten.md"]
    assert legacy_path.read_bytes() == before      # byte-identical


def test_legacy_block_against_structured_page_preserves(storage):
    calls = []
    gen_a = _page_block("wiki/concepts/kept.md", "Kept",
                       ["Structured claim.（来源: a.pdf）"], ["a.pdf"])
    _compile(storage, "/docs/a.pdf", gen_a, calls, source_text="A")
    before = (storage / "wiki" / "concepts" / "kept.md").read_bytes()

    legacy_block = "===FILE: wiki/concepts/kept.md ===\n# Kept\n\n纯文本无 frontmatter。\n"
    r2 = _compile(storage, "/docs/b.pdf", legacy_block, calls, source_text="B")
    assert (storage / "wiki" / "concepts" / "kept.md").read_bytes() == before
    assert r2.skipped == ["wiki/concepts/kept.md"]


# ---------------------------------------------------------------------------
# Compile state file
# ---------------------------------------------------------------------------

def test_state_file_records_fingerprint_and_ownership(storage):
    calls = []
    gen = _page_block("wiki/concepts/rule.md", "Rule",
                      ["Claim.（来源: a.pdf）"], ["a.pdf"])
    _compile(storage, "/docs/a.pdf", gen, calls, source_text="A")
    state = json.loads(
        (storage / "wiki" / ".compile_state.json").read_text(encoding="utf-8"))
    assert "/docs/a.pdf" in state
    assert state["/docs/a.pdf"]["pages"] == ["wiki/concepts/rule.md"]
    assert len(state["/docs/a.pdf"]["sha"]) == 40


# ---------------------------------------------------------------------------
# Page model sanity (ported engine)
# ---------------------------------------------------------------------------

def test_page_render_parse_round_trip_with_contradictions():
    from agenticx.brain.wiki.page import Claim, WikiPage
    page = WikiPage(
        page_type="analysis", title="Refund", description="desc",
        claims=[Claim(text="c1", sources=["a.pdf"])],
        contradiction_claims=[Claim(text="x vs y", sources=["a.pdf", "b.pdf"])],
        sources=["a.pdf"])
    md = page.render()
    parsed = WikiPage.parse(md)
    assert parsed.title == "Refund"
    assert parsed.page_type == "analysis"
    assert [c.text for c in parsed.claims] == ["c1"]
    assert [c.text for c in parsed.contradiction_claims] == ["x vs y"]
    assert parsed.status == "contradicted"
    assert parsed.merged_sources() == ["a.pdf", "b.pdf"]


def test_near_regexes_still_parse_rendered_frontmatter():
    """The rendered pages must survive Near's line-level frontmatter regexes
    (wiki_ops.list_wiki_pages / wiki_graph._parse_frontmatter)."""
    import re
    from agenticx.brain.wiki.page import Claim, WikiPage
    title_m = re.compile(r"^title:\s*[\"']?(.+?)[\"']?\s*$", re.MULTILINE)
    type_m = re.compile(r"^type:\s*[\"']?(.+?)[\"']?\s*$", re.MULTILINE)
    sources_m = re.compile(r"^sources:\s*\n((?:\s+-\s+.+\n?)*)", re.MULTILINE)
    page = WikiPage(page_type="concept",
                    title="A " + "long " * 40 + "title",
                    claims=[Claim(text="fact", sources=["doc.pdf"])])
    md = page.render()
    assert title_m.search(md).group(1).strip() == page.title
    assert type_m.search(md).group(1).strip() == "concept"
    block = sources_m.search(md)
    assert block and "doc.pdf" in block.group(1)
