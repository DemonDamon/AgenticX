from agenticx.data_suite.governance.lineage_graph import build_lineage_graph
from agenticx.data_suite.jobs.lineage import LineageLog


def test_build_graph_from_tables_in_out():
    log = LineageLog()
    log.record("extract", meta={"tables_in": ["raw_orders"], "tables_out": ["stg_orders"]})
    log.record("load", meta={"tables_in": ["stg_orders"], "tables_out": ["dw_orders"]})
    g = build_lineage_graph(log)
    assert g.nodes == ["dw_orders", "raw_orders", "stg_orders"]
    assert ("raw_orders", "stg_orders") in g.edges
    assert ("stg_orders", "dw_orders") in g.edges


def test_ignores_self_edges_and_dedupes():
    log = LineageLog()
    log.record("a", meta={"tables_in": ["t1"], "tables_out": ["t1", "t2"]})
    log.record("b", meta={"tables_in": ["t1"], "tables_out": ["t2"]})
    g = build_lineage_graph(log)
    assert ("t1", "t1") not in g.edges
    assert g.edges.count(("t1", "t2")) == 1
