# W2 Executable Subplan — NL2SQL 讲解模式

> Parent: master plan  
> Depends: W1 interface freeze (error codes)  
> Branch: `feat/agx-safe-query-w2-nl2sql-explain`  
> Parallel OK with W3

## Goal
Add `mode=explain|execute` (default execute). Explain returns plan/SQL and never hits channel execute.

## Steps
- [ ] Add mode param on NL2SQL entrypoints / agent template inputs
- [ ] explain path: return structured result with `executed: false`; no channel.query
- [ ] execute path: unchanged read-only + write gate
- [ ] invalid mode → `invalid_query_mode`
- [ ] Tests in `tests/managed/templates/test_nl2sql.py` (+ llm stub tests if needed)
- [ ] PR `feat(data-suite): nl2sql explain mode`

## Done when
Default execute unchanged; explain proven zero side-effect via mock channel.
