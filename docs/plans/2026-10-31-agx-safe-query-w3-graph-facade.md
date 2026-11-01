# W3 Executable Subplan — 图读门面与写不变量

> Parent: master plan  
> Parallel OK with W2  
> Branch: `feat/agx-safe-query-w3-graph-facade`

## Goal
Document and harden GraphStore recommended read APIs (`neighborhood`/`subgraph`); make publish warnings semantics testable.

## Steps
- [ ] Document recommended read facade in store README or docs
- [ ] Review `publish.py` return shape; add/normalize `warnings` without lying about primary upsert success
- [ ] Tests for neighborhood + publish warning fixture
- [ ] PR `feat(knowledge): graph read facade invariants`

## Done when
Tests green; docs state sole recommended read surface.
