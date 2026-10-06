# 连接器网关接入总体规划（open-connector）

日期：2026-10-06
状态：规划完成，待实施
研究依据：`research/codedeepresearch/open-connector/`（SELECTIVE_ADOPT，锁定 SHA eb4cb13）

## 背景

open-connector 是「AI Agent 的开源连接器网关」（Pipedream/Composio 替代）：1,579 provider / 11,464 action，凭据留在网关侧，Agent 经一个 MCP 端点以 5 个发现型工具（list_apps / list_connections / search_actions / get_action_guide / execute_action）访问全部动作。调研结论 SELECTIVE_ADOPT：

- **做**：市场以「连接器网关」精选条目最小接入（复用现有安装管线，零后端改动）。
- **不做**：收割 1579 provider 目录做卡片（离网关不可安装，G-004）；进程内嵌（Electron 34.5.8 内置 Node 20.19.1 < 22.18+）；连接管理 UI（归 Enterprise 轨道）。

与已建插件市场的关系：市场是「货架 + 管道」（场景分类/安装编排/详情页/三层管理），网关是新「货源」（一条 MCP 配置 = 全量动作供给）。

## 两轨道与 subplan 索引

| subplan | 轨道 | 交付物 | 性质 |
|---|---|---|---|
| [01-market-entry](2026-10-06-connector-gateway-01-market-entry.plan.md) | 桌面端 | 市场「连接器网关」精选条目（数据+UI+双形态安装+PoC） | 代码（TDD） |
| [02-enterprise-reference](2026-10-06-connector-gateway-02-enterprise-reference.plan.md) | Enterprise | 治理 MCP 网关参照设计文档（open-connector 机制映射） | 设计文档 |

## 执行顺序

1. subplan 01 先行（独立可交付，≤2 周；其中 PoC 与 Task 1 可并行）。
2. subplan 02 随后（消费调研产物，不阻塞 01；可在 01 等待 PoC 环境时并行起草）。

## 两轨道唯一交集（已埋钩子）

网关端点为**可配置参数**（托管 URL / 自建 URL + token），不写死任何端点——Enterprise 治理网关将来落地时，只需将其变为推荐值，桌面侧零返工。

## 统一边界（两个 subplan 共同遵守）

- 不引入 connector-sdk / oo-cli 依赖，不 fork provider 集自维护。
- 凭据与连接管理不进桌面市场（条目只写 MCP server 配置；凭据在网关侧）。
- 卡片/文档使用官方外链与文字描述，不搬第三方品牌资产（上游 Apache-2.0 商标除外条款）。
- 不提竞品名称（沿用既有约定）。
