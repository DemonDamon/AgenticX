"""Wiki graph payload for the browse UI."""

from agenticx.brain.wiki_graph import wiki_graph_payload
from agenticx.brain.wiki_ops import clear_sample_wiki, list_wiki_pages, read_wiki_page, seed_sample_wiki


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
    assert kept.is_file()
    titles = {page["title"] for page in list_wiki_pages(tmp_path)}
    assert titles == {"Mine"}
