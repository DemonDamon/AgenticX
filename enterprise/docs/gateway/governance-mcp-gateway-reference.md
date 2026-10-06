# 治理 MCP 网关参照设计（open-connector 机制映射）

> 参照实现：`oomol-lab/open-connector`，锁定 SHA `eb4cb13`。
> 证据索引：[research/codedeepresearch/open-connector/open-connector_source_notes.md](../../../research/codedeepresearch/open-connector/open-connector_source_notes.md)（Evidence ID E-001~E-016，全部 local-source 静态审读）。
> 状态：**设计参照文档，未实施**。规划出处：[.cursor/plans/2026-10-06-connector-gateway-master.plan.md](../../../.cursor/plans/2026-10-06-connector-gateway-master.plan.md) subplan 02。

---

## 1. 定位

Enterprise 的对标定位是「企业 AI 使用的治理基座」，治理 MCP 网关是该定位下企业 Agent 流量的**必经之路**方向（P0 规划方向，承接既有规划讨论结论）。它解决四件事：

| 治理问题 | 含义 |
|---|---|
| 凭据边界 | 第三方 SaaS 凭据（OAuth2 / API key）不进 Agent 进程与客户端配置 |
| 服务端凭据保管 | 凭据集中加密保管、按连接生命周期管理（授权 / 轮转 / 撤销） |
| 策略执行 | 动作级 + 连接级的允许 / 阻止，在执行前拦截而非事后审计 |
| 审计链 | 每次外部动作执行可回溯到「谁、用哪个连接、执行了什么动作、结果如何」 |

**与「业务数据基座」路线的区隔**：治理网关管的是 *Agent ↔ 外部系统的动作流量*（凭据 / 策略 / 审计的必经通道）；业务数据基座管的是 *企业数据资产供给*（知识库、数据源检索）。两者互补，本文档只覆盖前者。

为什么选 open-connector 作参照：它是成熟的连接器网关（1,579 provider / 11,464 action，E-001），凭据边界、策略、审计、token 模型均有完整代码形态（E-003/E-004/E-010），可把「治理网关应该长什么样」从抽象需求变成可核对的设计要素。

---

## 2. 机制映射表

open-connector 机制 → Enterprise 治理网关设计要素（每行溯源到 Evidence ID）：

| # | open-connector 机制（证据） | Enterprise 治理网关设计要素 |
|---|---|---|
| 1 | 凭据边界：连接与凭据在网关侧，Agent 只见账号标签与执行结果（E-003/E-007） | 服务端凭据保管；client 侧零第三方凭据——「凭据不落 Agent」是治理底线 |
| 2 | 凭据加密存储：`dataDir` + `encryptionKey` 显式配置（E-004） | 凭据保管的静态加密与密钥管理要求（密钥独立于业务数据层） |
| 3 | runtime token / admin token / JWT 三层 token（E-004） | 认证模型：管理面（admin）与运行面（runtime / Agent）分离，权限互不越界 |
| 4 | actionPolicy allow/block（`service.*` / `*` 通配）+ 连接级 `evaluateConnection` 授权（E-003/E-004） | 策略引擎双粒度：动作级 + 连接级，执行前拦截（区别于现有内容三通道，见 §3） |
| 5 | 运行审计 + 脱敏日志 + `executionId` 贯穿每次执行（E-003） | 审计链路与可观测性：执行记录归一到可查询维度（人 / 连接 / 动作 / 结果） |
| 6 | SSRF 守护 fetch：请求与每个重定向 Location 校验、DNS 解析地址默认校验（E-010） | 出网安全基线：网关代发外部请求（含重定向链）必须内置同等守护 |
| 7 | 5 个发现型 MCP 工具（list_apps / list_connections / search_actions / get_action_guide / execute_action）收纳上万动作（E-003） | 大规模工具供给的暴露面设计：「搜索-发现-执行」，工具数与目录规模解耦，避免上下文淹没 |
| 8 | headless 嵌入（Node 22.18+）+ 选定 provider 裁剪构建 `getConnectorBuildOptions`（E-004/E-005/E-015） | 部署形态与供给裁剪：Go 网关无法进程内嵌 Node 运行时，须独立进程部署；供给可按租户 / 场景裁剪以收敛攻击面 |

补充两条设计原则（源自调研结论，G-003）：

- 工具面超过数百个时采用发现型工具而非平铺（适用条件：工具面规模膨胀）。
- 目录是生成的派生物，定义源码才是事实源——防止手工改目录造成漂移（E-006）。

---

## 3. 与现有 Enterprise 网关的差距对照

现有能力（详见对应文档）：

- **MCP 托管**（[mcp-hosting-overview.md](./mcp-hosting-overview.md)）：`GATEWAY_MCP_HOSTING` 默认关闭；registry（PG `mcp_servers` + `/admin/mcp-servers` 登记）+ entitlement + echo/openapi backend；`custom-go` 留口未落地；每次 `tools/call` 过策略、配额后写 `gateway_audit_events`。
- **策略引擎**（[policy-engine.md](./policy-engine.md)）：Request / Response / Stream 三通道 + `mcp_tool` 阶段；规则 keyword / regex / pii；动作 block / warn / redact——**内容治理维度**。
- **Key Pool / PAT**（[keypool-pat-overview.md](./keypool-pat-overview.md)）：保管的是 LLM provider key（供给模型调用），PAT 是人 / 服务身份。
- **tools-mcp 功能包**：`enterprise/features/tools-mcp` 仅为 stub（`TODO: implement`），[features/README.md](../features/README.md) 标 ⚪「规划 MCP 市场」——MCP 市场 UI 未 enterprise 化。

目标态 vs 现状：

| 目标态能力 | 现状 | 缺口 |
|---|---|---|
| 服务端第三方凭据保管（OAuth2 / API key 连接） | 无（keypool 仅 LLM provider key） | 需新建「连接」模型：授权 / 轮转 / 撤销 + 加密存储 |
| 动作级 + 连接级策略（执行前拦截） | 仅内容三通道（block/warn/redact） | 策略面扩展：action allow/block + 连接授权 |
| 连接管理 UI（admin-console） | 无（仅有 mcp_servers 登记页） | 连接生命周期管理界面 |
| 执行审计含连接 / 动作维度 | 有审计链（JSONL + PG + checksum），无连接 / 动作维度 | 审计 schema 扩展 + executionId 贯穿 |
| 出网 SSRF 守护（代发外部请求） | Go 网关出网为 LLM 上游中继，无通用守护 | 连接器代发路径需补 SSRF / 重定向 / DNS 校验 |
| 发现型工具供给面 | mcp-hosting 每 server 一条直出 | 大规模供给时的暴露面设计（原则已定，实施待供给规模触发） |

---

## 4. 与桌面端的衔接

桌面市场已落地「连接器网关」精选条目（subplan 01，commit `af2965d4`）：安装弹层支持托管 / 自建双形态，**网关端点是可配置参数（URL + token），不写死任何端点**。

企业网关落地后的衔接方式：

- 桌面侧只需把企业网关 URL 变为推荐值 / 默认值（预置或管理面下发），安装管线零返工——这是两轨道预留的唯一交集钩子。
- Enterprise 试点阶段的验收路径直接走桌面安装链路（网关条目 → 对话内 5 工具调用）。

---

## 5. 阶段路线

### 阶段 0：参照评估（本文档）

- 进入：调研结论 SELECTIVE_ADOPT（已达成，G-001/G-002）。
- 退出：设计评审通过；「凭据托管 vs 策略引擎谁先行」列为 PoC 必答议题。

### 阶段 1：内部 PoC（自托管 open-connector 供给内部 Agent）

- **进入条件**：Docker 或单文件二进制环境（外置部署，Node 22.18+ 约束 E-005）；≥1 个内部 Agent（桌面或 edge-agent）；选定 provider 子集（E-015 裁剪构建收敛攻击面）。
- **动作**：部署自托管实例 → 桌面网关条目 self-host 形态接入 → 验证 5 工具链路（`search_actions` → `execute_action` 跑通 no-auth 动作）→ 建立 1 条真实 OAuth 连接 → 配置 actionPolicy 阻断 1 个动作验证策略生效 → 核对审计记录与脱敏日志。
- **退出条件**：5 工具链路跑通；凭据保管 / 策略 / 审计三项机制可行性有结论；**定序结论**（凭据托管先行还是策略引擎先行）；出网安全基线（SSRF）评估通过。
- 备注：subplan 01 的 AC-4（托管端点 `search_actions` 实测）因托管服务要求 runtime token 降级为观察项，本阶段用自托管实例闭环同一验证目标。

### 阶段 2：试点（企业网关成为内部连接器供给入口）

- **进入条件**：PoC 退出条件全部满足；安全评审（token 模型 / SSRF / 凭据加密）通过；admin-console 连接管理最小 UI 方案确定。
- **动作**：企业网关 URL 作为桌面网关条目推荐值；试点租户安装使用；审计查询可用。
- **退出条件**：试点租户安装成功率与 Agent 首次调用成功率达标（阈值试点启动前确定）；审计 / 计量能回答「谁在何时用哪个连接执行了什么动作」；自研网关 vs 长期自托管 open-connector 的决策依据成文。

---

## 6. 明确不做

- 不做业务数据基座（与治理网关的区隔见 §1）。
- 不自研 provider 目录，不 fork open-connector 的 provider 集自维护。
- 不预设凭据托管与策略引擎的实施顺序（留给 PoC 定序结论）。
- 桌面侧不做连接管理 UI（凭据在网关侧，桌面只写 MCP server 配置）。
- 不搬第三方品牌资产（上游 Apache-2.0 的商标除外条款，E-012）；对外引用一律走官方外链。
- 不提竞品名称（沿用既有约定）。

---

## 材料索引

| 材料 | 位置 |
|---|---|
| 源码证据（E-001~E-016） | `research/codedeepresearch/open-connector/open-connector_source_notes.md` |
| Gap 分析（G-001~G-005） | `research/codedeepresearch/open-connector/open-connector_agenticx_gap_analysis.md` |
| 采纳提案（SELECTIVE_ADOPT） | `research/codedeepresearch/open-connector/open-connector_proposal.md` |
| 总体规划（两轨道） | `.cursor/plans/2026-10-06-connector-gateway-master.plan.md` |
| 桌面端 subplan 01（已实施） | `.cursor/plans/2026-10-06-connector-gateway-01-market-entry.plan.md` |
