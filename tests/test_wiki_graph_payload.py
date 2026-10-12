"""Wiki graph payload for the browse UI and retrieval expansion."""

from agenticx.brain.wiki_graph import expand_hits_with_wiki_graph, wiki_graph_payload
from agenticx.brain.wiki_ops import clear_sample_wiki, list_wiki_pages, read_wiki_page, seed_sample_wiki
from agenticx.studio.kb.contracts import RetrievalHit, RetrievalHitSource


def test_ontology_query_follows_matching_page_not_filename_cluster(tmp_path):
    wiki = tmp_path / "wiki"
    (wiki / "sources").mkdir(parents=True)
    (wiki / "sources" / "lecture.md").write_text(
        "---\ntitle: 老刘说NLP第四十六讲 Palantir本体论\ntype: source-summary\n---\n"
        "见 [[ontology-compare]] 与 [[graphrag-routes]]\n",
        encoding="utf-8",
    )
    (wiki / "ontology-compare.md").write_text(
        "---\ntitle: 三大Ontology对比\ntype: concept\n---\n"
        "本体建模里，Palantir 以业务为中心，OWL 是另一套形式化做法。\n",
        encoding="utf-8",
    )
    (wiki / "graphrag-routes.md").write_text(
        "---\ntitle: GraphRAG两条技术路线\ntype: concept\n---\n见 [[lightrag]]\n",
        encoding="utf-8",
    )
    (wiki / "lightrag.md").write_text(
        "---\ntitle: LightRAG\ntype: entity\n---\nGraphRAG 的一种实现。\n",
        encoding="utf-8",
    )
    chunk = RetrievalHit(
        id="chunk-1",
        score=0.55,
        text="01 定义对象 02 添加属性",
        source=RetrievalHitSource(
            uri="/docs/知识图谱、GraphRAG、palantir本体论.pdf",
            title="知识图谱、GraphRAG、palantir本体论.pdf",
        ),
    )
    expanded = expand_hits_with_wiki_graph(
        tmp_path,
        query="老刘说了关于本体的东西，本体建模的过程是咋样的",
        hits=[chunk],
        top_k=5,
    )
    ids = [hit.id for hit in expanded]
    assert ids[0] == "chunk-1"
    assert "wiki::ontology-compare" in ids
    assert "wiki::lightrag" not in ids
    assert "wiki::graphrag-routes" not in ids
    wiki_scores = [hit.score for hit in expanded if str(hit.id).startswith("wiki::")]
    assert wiki_scores
    assert max(wiki_scores) < 1.0


def test_wiki_graph_payload_serializes_nodes_and_wikilinks(tmp_path):
    wiki = tmp_path / "wiki"
    wiki.mkdir()
    (wiki / "alpha.md").write_text(
        "---\ntitle: Alpha\ntype: concept\nsources:\n  - handbook.md\n---\nSee [[beta]]\n",
        encoding="utf-8",
    )
    (wiki / "beta.md").write_text(
        "---\ntitle: Beta\ntype: entity\n---\n",
        encoding="utf-8",
    )

    payload = wiki_graph_payload(tmp_path)
    by_id = {node["id"]: node for node in payload["nodes"]}
    assert by_id["alpha"]["title"] == "Alpha"
    assert by_id["alpha"]["type"] == "concept"
    assert by_id["alpha"]["sources"] == ["handbook.md"]
    assert {"source": "alpha", "target": "beta"} in payload["edges"]


def test_sample_wiki_lists_pages_links_and_purpose(tmp_path):
    written = seed_sample_wiki(tmp_path)
    assert "wiki/concepts/annual-leave.md" in written
    pages = list_wiki_pages(tmp_path)
    titles = {page["title"] for page in pages}
    assert {"员工手册", "年假", "费用报销", "公司", "请假申请"} <= titles
    leave = read_wiki_page(tmp_path, "wiki/concepts/annual-leave.md")
    assert leave is not None and "[[concepts/leave-requests]]" in leave
    payload = wiki_graph_payload(tmp_path)
    edges = {(edge["source"], edge["target"]) for edge in payload["edges"]}
    assert ("concepts/annual-leave", "concepts/leave-requests") in edges
    assert ("index", "concepts/expense") in edges
    purpose = (tmp_path / "purpose.md").read_text(encoding="utf-8")
    assert "知识库目标" in purpose
    kept = tmp_path / "wiki" / "concepts" / "mine.md"
    kept.parent.mkdir(parents=True, exist_ok=True)
    kept.write_text("---\ntitle: Mine\ntype: concept\n---\n# Mine\n", encoding="utf-8")
    removed = clear_sample_wiki(tmp_path)
    assert "wiki/concepts/annual-leave.md" in removed
    assert "purpose.md" in removed
    assert (tmp_path / "purpose.md").read_text(encoding="utf-8") == ""
    assert kept.is_file()
    titles = {page["title"] for page in list_wiki_pages(tmp_path)}
    assert titles == {"Mine"}
