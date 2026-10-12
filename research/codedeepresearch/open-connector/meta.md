# open-connector Research Meta

## Research Status
- [x] S0 Scope, workspace, and tool availability confirmed
- [x] S1 Upstream cloned and commit SHA locked
- [x] S2 Relevant AgenticX baseline verified
- [x] S3 Upstream execution path verified from local source
- [-] S4 Applicable DeepWiki and extra URL sources processed — DeepWiki/ZRead/GitHub MCP 均不可用，用户未提供额外 URL；本地源码为准
- [x] S5 Candidate claims cross-checked against source — local-only; no external claims
- [x] S6 Gap analysis and verdict derived
- [x] S7 Proposal and evaluation gates written
- [x] S8 Final quality gates passed

## Scope
- User goal: 评估 oomol-lab/open-connector 能否将大量连接器纳入 AgenticX 桌面版插件市场
- Requested depth: 标准深度（六类证据 + Gap + Proposal）
- Constraints: 仅调研，不改 AgenticX 生产代码；不新增依赖；不提及竞品名称
- Priority: 可维护性/掌控力 > 延迟/成本

## Assumptions
- Research only; no AgenticX implementation.
- Prefer zero new dependencies.
- Maintainability/control and regression safety outrank latency/cost.
- Analyze only modules relevant to the connector-catalog/marketplace goal.

## Upstream
- URL: https://github.com/oomol-lab/open-connector
- Branch/tag: main
- Locked SHA: eb4cb13921cfa489cea2efdbd9df56a84eebe4c1
- License: Apache-2.0（第三方商标/品牌资产明确不在授权内）
- Main languages: TypeScript（6,681 .ts；provider 目录 1,579 个，action 声明 11,464 处）
- Monorepo: yes（runtime src/ + web Console workspace + migrations）
- Runtime validation: static_only（无 Docker/独立 Node 22 环境，未执行运行时）

## Tool Availability
- DeepWiki: unavailable — 当前会话无 DeepWiki MCP server
- GitHub MCP: unavailable as MCP — 会话未挂载；Issue/PR 历史 not retrieved
- ZRead: unavailable — 当前会话无 ZRead MCP server
- MCP assist: none (local-source primary)

## External Source Status
- DeepWiki: skipped — 工具不可用（不影响本地源码研究完整性）

## Artifacts
- open-connector_source_notes.md（证据 E-001~E-016 + 交叉核对）
- open-connector_code_index.md
- open-connector_agenticx_gap_analysis.md（G-001 P1 / G-002 P1(Enterprise) / G-003 P2 / G-004 G-005 NO-GAP）
- open-connector_proposal.md（SELECTIVE_ADOPT）

## Verdict
SELECTIVE_ADOPT —— 市场以「连接器网关」精选条目最小接入（复用现有安装管线），不做目录收割/进程内嵌/连接 UI。

## Follow-up（2026-10-06 实施收口）
- subplan 01（桌面端）已实施：市场「连接器网关」精选卡 + 双形态安装弹层，commit `af2965d4`；CDP 实机验证 AC-1/2/3（截图 screenshots-subplan01/），AC-4 降级为观察项（托管端点需 runtime token，401 实测）
- subplan 02（Enterprise）已实施：治理 MCP 网关参照设计文档 `enterprise/docs/gateway/governance-mcp-gateway-reference.md`（机制映射 8 行全带 Evidence ID），commit `fea9229b`
- 后续信号：网关条目真实使用量 → 是否投入 sidecar 内置；Enterprise PoC（自托管实例）承接 AC-4 验证与凭据/策略定序
