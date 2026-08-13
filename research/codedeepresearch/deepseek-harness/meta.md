# deepseek-harness Research Meta

## Research Status
- [x] S0 Scope, workspace, and tool availability confirmed
- [x] S1 Upstream cloned and commit SHA locked
- [x] S2 Relevant AgenticX baseline verified
- [x] S3 Upstream execution path verified from local source
- [x] S4 Applicable DeepWiki and extra URL sources processed
- [x] S5 Candidate claims cross-checked against source
- [x] S6 Gap analysis and verdict derived
- [x] S7 Proposal and evaluation gates written
- [x] S8 Final quality gates passed

## Scope
- User goal: 调研 DeepSeek Harness 核心 harness（尤其长程任务稳定执行）能否沉淀进 AgenticX 底层框架
- Requested depth: code-deep-research 全流程（S0–S8）
- Constraints: 仅研究、不改 AgenticX 生产代码；优先零新依赖；可维护性/控制力与回归安全优先于延迟/成本
- Priority: 仅分析与「核心 agent loop / 长程稳定执行」相关的模块（agent-loop、session persistence/checkpoint、compaction/spill、guard/loop-hygiene、workflow/ralph、jobs/goal、subagent），不展开 Web UI、Typert、Landlock 全量、Python SDK 产品面

## Assumptions
- Research only; no AgenticX implementation.
- Prefer zero new dependencies.
- Maintainability/control and regression safety outrank latency/cost.
- Analyze only modules relevant to the user’s stated goal.
- 不把「everything is a plugin / Cordis」整体运行时迁入 AgenticX；只评估可内化的长程执行机制。
- GitHub MCP 工具发现失败，Issue/PR 历史走 ZRead 或标记 not retrieved。

## Upstream
- URL: https://github.com/deepseek-ai/deepseek-harness.git
- Branch/tag: master (origin/master)
- Locked SHA: 47f943859bef60e4160492346772ded9b24f765a
- License: MIT
- Main languages: TypeScript (pnpm monorepo), Python SDK (`python/`), native landlock (`native/`)
- Monorepo: yes
- Runtime validation: static_only（未安装 pnpm 依赖、无 DEEPSEEK_API_KEY 的真实 agent 跑通；不以 README 宣称代替源码）

## Tool Availability
- DeepWiki: available — 6 问已完成并对照本地源
- GitHub MCP: failed — live tool discovery error; `mcp_auth` retry still error
- ZRead: failed — `search_doc` 429 余额不足；不视为源码研究不完整
- MCP assist: partial

## External Source Status
- DeepWiki: completed（见 `deepseek-harness_deepwiki.md`）
- Extra URLs: none provided（仅 GitHub clone URL；上传的页面快照不作独立 extra source）

## Artifacts
- `meta.md`
- `upstream/` @ 47f943859bef60e4160492346772ded9b24f765a
- `deepseek-harness_source_notes.md`
- `deepseek-harness_code_index.md`
- `deepseek-harness_deepwiki.md`
- `deepseek-harness_agenticx_gap_analysis.md`
- `deepseek-harness_proposal.md`

## S8 gate checklist
- [x] upstream/ exists; SHA locked in this file
- [x] S0–S7 are [x]; none [ ] or [!]
- [x] Six source evidence categories inspected (entry, abstraction, execution, failure, extension, test)
- [x] Evidence IDs resolve from Gap/Proposal to source locations
- [x] Code index records local / GitHub-failed / ZRead-failed / DeepWiki provenance
- [x] Candidate claims cross-checked in source notes
- [x] AgenticX checked paths and search terms recorded
- [x] Each P1 has Gap ID, acceptance evidence, scope boundary (no P0)
- [x] Verdict SELECTIVE_ADOPT matches “no P0, ≥1 validated P1”
- [x] Unrun examples, missing Issues/PRs, unused `is_context_window_exceeded_error` made explicit
- [x] ZRead failure not treated as incomplete local-source study
