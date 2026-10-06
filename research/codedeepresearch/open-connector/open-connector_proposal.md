# open-connector AgenticX Proposal

## Decision
- Verdict: SELECTIVE_ADOPT
- Why:
  - G-001：用户明确要「把很多连接器纳入市场」；OpenConnector 以单一 MCP 端点提供 1,579 provider / 11,464 action（E-001/E-003），AgenticX 市场现有安装管线即可承接，最小路径两周内可验证。
  - E-005 vs A-4：Node 20.19.1（Electron 34.5.8）< 22.18+，进程内嵌被上游文档性约束排除，只能走外置/sidecar 形态，完整嵌入成本高 → 不满足 P0。
  - G-002：其治理面（凭据边界/策略/审计）是 Enterprise 治理 MCP 网关方向的成熟参照，但属另一轨道。
- Now: 把 OpenConnector 接成市场「连接器网关」精选条目（纯数据 + 现有安装编排），并实测 5 工具 MCP 在 Near Agent 的可用性。
- Later: G-002 Enterprise 治理网关参照；G-003 发现型工具面原则；若网关条目有真实使用量，再评估 sidecar 二进制内置。
- Explicitly not doing:
  - 收割 1,579 provider 目录生成市场卡片（无网关不可安装，G-004）。
  - 进程内嵌 @oomol-lab/open-connector（Node 版本约束，A-4/E-005）。
  - 引入 connector-sdk / oo-cli 依赖或 fork 其 provider 集自维护。
  - 在桌面轨道实施连接管理 UI 与凭据托管（归 Enterprise 轨道评估）。

## 1. Background and boundaries
用户诉求：借助 oomol-lab/open-connector 扩充桌面插件市场的连接器供给。研究边界：仅调研；上游锁定 eb4cb13；AgenticX 侧已检查范围见 gap 报告。OpenConnector 定位为「AI Agent 的开源连接器网关（Pipedream/Composio 替代）」，核心不是目录而是运行时：账号连接 + 凭据边界 + 策略 + 审计，经一个 MCP 端点以 5 个发现型工具暴露全部动作。

## 2. Verified upstream mechanisms
- 目录与懒加载：definition.ts 为源 → generate:catalog → 运行时 CatalogStore；执行器仅执行时动态 import（E-006/E-009）。
- MCP 面：list_apps / list_connections / search_actions / get_action_guide / execute_action；无状态 Streamable HTTP；策略与连接授权前置校验（E-003）。
- 嵌入与部署：headless npm 包（Node 22.18+）、Docker/GHCR、单文件二进制、Cloudflare/Fly/Helm；支持选定 provider 裁剪构建（E-004/E-005/E-015）。
- 安全与治理：SSRF 守护 fetch、错误工厂与超时约定、凭据加密、runtime/admin token、action allow/block、审计与脱敏日志（E-010）。
- 商业衔接：OOMOL 托管 OAuth/运行时；网关内置 SaaS 动作市场客户端（E-011）。

## 3. Minimal transferable principles and invariants
- 「一条 MCP 配置 = 一个网关 = 全量动作」的供给形态，优于市场平铺数千 server 条目。
- 发现型工具面：工具数与目录规模解耦，agent 用搜索+指南+执行三步走。
- 凭据留在网关、agent 只见账号标签与结果；写操作必须显式连接选择。
- 目录是生成的派生物，定义源码才是事实源（防手改漂移）。

## 4. AgenticX design
### API/SDK contract
不新增 API。复用现有 `/api/mcp/marketplace/install`（mcpServers 合并 + env 覆写）安装网关 MCP 配置：hosted 形态 `https://connector.oomol.com/mcp`（如需 runtimeToken 走 env），self-host 形态用户填 `http://localhost:3000/mcp`。
### Modules and data flow
`desktop/src/data/` 新增网关精选条目数据（名称/图标/描述/双形态安装参数）→ 市场连接器 Tab 展示 → 安装走现有 mcp-marketplace-install 等价编排（本地直写配置，绕开 ModelScope 上游）→ 已装判定沿用 isMcpInstalled。
### Algorithms/policies
无新算法。安全提示：条目文案明确「凭据配置在网关侧（OOMOL 托管或自托管控制台），Near 不保管第三方凭据」。
### Errors and observability
沿用市场现有错误降级；验收脚本记录 search/execute 往返。

## 5. Integration phases: PoC → MVP → stabilization
- PoC（≈2 天）：手动在 Near 添加 OpenConnector MCP（任一形态），验证 5 工具可用、hackernews no-auth 动作跑通；确认工具描述对模型的友好度。
- MVP（≤2 周）：市场「连接器网关」精选卡片 + 双形态安装（self-host URL 输入 + 可选 token env）+ 文案与帮助链接；已装判定与卸载回归。
- Stabilization：使用反馈决定是否推进 sidecar 内置（单文件二进制随桌面分发，Node 版本独立）与连接管理 UI（转 Enterprise 评估）。

## 6. Evaluation: tasks, metrics, regression gates
- 任务：安装网关条目 → 对话内要求「搜索并执行 hackernews.get_top_stories」→ 断言返回数据；卸载后名册消失。
- 指标：安装成功率；Agent 首次调用成功率；marketplace 既有 77 用例全绿。
- 回归门：现有市场套件测试不回退；不触碰 ModelScope 上游链路。
- 明确未验证：OAuth 连接全流程（需真实 provider 账号）；OOMOL 托管服务可用性；Cloudflare 部署形态。

## 7. Risks and rollback
- 外部依赖：OOMOL 托管端点可用性/配额 → 提供 self-host 指引为第二形态。
- 安全认知：写操作直达外部系统 → 卡片文案显式警示；策略由网关侧承担。
- 合规：Apache-2.0 允许接入；商标/品牌资产不搬入（E-012），卡片用官方外链。
- 回滚：删除精选条目数据即可，无代码耦合。

## 8. 下一步规划调整
1. 桌面市场（近期）：落地 G-001 最小路径——网关精选条目 + 双形态安装 + PoC 验收（上节第 5/6 条）。
2. Enterprise 轨道（规划输入）：把 open-connector 记为「治理 MCP 网关」参照实现（凭据边界/策略/审计/token 的代码形态），纳入该方向的方案比对。
3. 设计原则沉淀：发现型工具面（G-003）写入内部设计笔记，适用条件=工具面规模膨胀。
4. 观察项：网关条目真实使用量作为是否投入 sidecar 内置的唯一推进信号。
