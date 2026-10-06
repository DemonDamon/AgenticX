# Subplan 02：Enterprise 治理 MCP 网关参照设计（open-connector 机制映射）

日期：2026-10-06
状态：已实施（2026-10-06，见文末实施结果）
父计划：[connector-gateway-master](2026-10-06-connector-gateway-master.plan.md)

## 背景与目标

Enterprise 版对标定位（承接既有讨论结论）：**企业 AI 使用的治理基座**，治理 MCP 网关是企业 Agent 流量的「必经之路」方向（P0 规划方向）。open-connector 恰是该方向的成熟开源参照实现——本 subplan 把调研证据转译为 Enterprise 网关的设计参照文档，**不写代码**。

## 交付物

`enterprise/docs/` 下新增 `governance-mcp-gateway-reference.md`（实施时确认子目录与命名惯例），内容框架：

1. **定位**：治理 MCP 网关解决什么（凭据边界 / 策略执行 / 审计链 / 服务端凭据保管），对标定位下与「业务数据基座」路线的区隔。
2. **机制映射表**（open-connector → Enterprise 设计要素，全部带 Evidence ID 溯源）：

| open-connector 机制（证据） | Enterprise 网关设计要素 |
|---|---|
| 凭据边界：连接与凭据在网关侧，Agent 只见账号标签（E-003/E-007） | 服务端凭据保管；client 侧零第三方凭据 |
| runtime token / admin token / JWT（E-004） | 网关认证模型：管理面与运行面分离 |
| actionPolicy allow/block（`service.*`/`*`）+ 连接级授权（E-003/E-004） | 策略引擎：动作级 + 连接级双粒度 |
| 运行审计 + 脱敏日志 + executionId（E-003） | 审计链路与可观测性 |
| SSRF 守护 fetch / 重定向校验 / DNS 解析校验（E-010） | 出网安全基线 |
| 5 工具发现型 MCP 面（E-003） | 大规模工具供给的暴露面设计 |
| headless 嵌入 + 选定 provider 裁剪构建（E-004/E-015） | 部署形态与供给裁剪选项 |

3. **与桌面端的衔接**：桌面市场网关条目的「可配置端点」即未来企业网关的分发入口（URL 推荐值替换即可）。
4. **差距对照**：当前 AgenticX `features/tools-mcp` stub 与 admin-console 现状 vs 目标态（引用既有结论）。
5. **阶段路线**：参照评估 → 内部 PoC（自托管 open-connector 对内部 Agent 供给） → 试点；每阶段的进入/退出条件。
6. **明确不做**：不做业务数据基座；不自研 provider 目录；凭据托管先行于策略引擎（或反之）需在 PoC 结论中定序。

## 任务拆解

| # | 任务 | 验证 |
|---|---|---|
| T1 | 确认 enterprise/docs 目录惯例与文档骨架 | 目录核对 |
| T2 | 撰写参照文档（机制映射全部溯源到 research/codedeepresearch/open-connector/ 证据） | 评审：每条机制可回溯 Evidence ID |
| T3 | 与既有 Enterprise 规划材料（admin-console 现状、四方向规划）交叉引用补齐 | 文内引用完整 |

## 验收标准（AC）

- AC-1：文档落地 enterprise/docs/，机制映射表 ≥7 行且每行有 Evidence ID
- AC-2：阶段路线含进入/退出条件，与桌面端 subplan 01 的衔接点显式成文
- AC-3：不包含未溯源的实现细节（无 Evidence 支撑的主张不进文档）

## 不做（本轮）

- 不写任何 Enterprise 代码 / 不改 admin-console
- 不做自托管 open-connector 的部署实施（属 PoC 阶段动作）
- 不预设凭据托管与策略引擎的实施顺序（留给 PoC 结论）

## 实施结果（2026-10-06）

### 交付物

- `enterprise/docs/gateway/governance-mcp-gateway-reference.md`（参照设计文档：定位与区隔 / 机制映射表 / 现状差距对照 / 桌面衔接 / 三阶段路线 / 明确不做 / 材料索引）
- `enterprise/docs/README.md` 网关章节登记新文档条目

### 验收记录

- AC-1 ✓：文档落地 `enterprise/docs/gateway/`（符合 gateway/ 子目录惯例）；机制映射表 8 行（≥7），每行溯源 Evidence ID（E-003~E-015）
- AC-2 ✓：三阶段（参照评估 / 内部 PoC / 试点）均含进入与退出条件；与 subplan 01 的衔接点在 §4 显式成文（可配置端点 → 推荐值替换零返工），并在 PoC 阶段承接 AC-4 观察项的自托管闭环路径
- AC-3 ✓：open-connector 机制主张全部带 Evidence ID；Enterprise 现状主张全部引用现有 docs（mcp-hosting-overview / policy-engine / keypool-pat-overview / features README）；定位与方向表述溯源到总体规划的讨论结论
- 交叉引用（T3）✓：现有网关文档（MCP 托管、策略引擎、Key Pool/PAT）、features/tools-mcp stub 现状、桌面 subplan 01 实施记录均在文内成链
