# open-connector × AgenticX Gap Analysis

Locked upstream SHA: `eb4cb13921cfa489cea2efdbd9df56a84eebe4c1`

## AgenticX Evidence
| Capability | Path | Symbol | Current behavior |
|---|---|---|---|
| 桌面 MCP 市场列表/详情/安装桥 | desktop/electron/preload.ts:585-596 | mcpMarketplaceList/Detail/Install | IPC → studio 后端 |
| 市场列表/安装后端 | desktop/electron/main.ts:10744-10810 | ipcMain.handle("mcp-marketplace-list"/detail/install) | 代理 `${studio}/api/mcp/marketplace`，安装=合并 mcpServers 配置 |
| studio 市场上游 | agenticx/studio/server.py:5457-5577 | list_marketplace_mcps / install_marketplace_mcp | 单一上游（ModelScope MCP 目录）分页检索；安装取 server_config[0].mcpServers 合并进本地配置，支持 env 覆写 |
| 市场前端模型 | desktop/src/components/marketplace/model.ts:61-71,182-212 | MarketMcpEntry / MarketplaceItem / isMcpInstalled | MCP 条目含 serverId/serverNames/logoUrl/categories，安装态按本机名册判定 |
| 桌面运行时版本 | desktop/package.json + 实测 | electron 34.5.8 | 内置 Node 20.19.1（ELECTRON_RUN_AS_NODE 实测） |
| 结论库 | conclusions/README.md:71-88,178 | tools/protocols 条目 | 已有 MCP 协议与工具系统结论；无连接器网关相关结论 |

## Checked scope
- Paths: desktop/electron/preload.ts、desktop/electron/main.ts、agenticx/studio/server.py、desktop/src/components/marketplace/、conclusions/README.md、desktop/package.json
- Search terms: mcp-marketplace、mcp/marketplace、mcpMarketplace、getStudioUrl、connector、gateway、electron version
- Scope limitation: 结论仅适用于上述已检查范围；未检查 agenticx Python runtime 的 MCP client 实现细节（与本 gap 无直接责任重叠）。

## 候选 Gap

### G-001 连接器网关式供给缺失（市场只有「每 server 一条」的目录模型）
- User problem: 用户原话「这个开源不是可以把很多连接器东西纳入进来吗」——希望市场连接器供给大幅扩容（此前市场增强系列工作即源于同一诉求）。
- Upstream evidence: E-001、E-003、E-004
- AgenticX current state: 市场单一上游（ModelScope MCP 目录，A-2），条目=可安装的 MCP server 配置；无「网关型」条目（一条 MCP 配置背后是 1,579 provider / 11,464 action + 账号连接管理）。
- Actual gap: 市场模型缺少 connector-gateway 形态；近端没有 OpenConnector 运行时的任何接入点。
- Value: high；Cost: low（最小路径）/ high（完整嵌入）；Regression risk: low
- Decision: P1 —— 代码级缺口与用户诉求均成立，但完整闭环（嵌入运行时+连接管理 UI）远超两周，不满足 P0 的可验证闭环要求；最小路径（精选网关条目+现有安装编排）两周内可验证。
- Minimal adoption: 市场新增「连接器网关」精选条目（OOMOL 托管端点 + 自托管 URL 两种形态），复用现有 mcpServers 安装管线与 env 覆写（填 runtimeToken），安装后 Agent 即可用 5 个 MCP 工具访问全部动作。
- Scope boundary: 不做 provider 目录收割、不做连接管理 UI、不引入新依赖。
- Acceptance evidence: 安装后在 Near 对话中 `search_actions("hackernews")` → `execute_action("hackernews.get_top_stories")` 成功返回（no-auth 动作）。

### G-002 凭据边界与治理面（凭据不进 Agent 进程 / runtime token / action 策略 / 审计）
- User problem: 用户在 Enterprise 规划讨论中明确认可「治理 MCP 网关」为 P0 方向（对标治理基座定位）；桌面侧尚无此诉求的直接用户证词 → 对桌面轨道记 unvalidated，对 Enterprise 轨道为已验证方向。
- Upstream evidence: E-003、E-004、E-010
- AgenticX current state: MCP 安装把 env 凭据写进客户端侧配置（A-2/A-3），无服务端凭据保管、无 action 级策略、无运行审计。
- Actual gap: 桌面与 Enterprise 均无连接器网关治理面。
- Value: high（Enterprise）；Cost: high；Regression risk: medium
- Decision: P1（归属 Enterprise 治理网关规划轨道，桌面不实施）
- Minimal adoption: no implementation —— 作为 Enterprise 治理 MCP 网关的参照实现（policy/token/audit/SSRF 守护的成熟代码形态）。
- Scope boundary: 不在桌面轨道落地；不 fork 其 provider 集。
- Acceptance evidence: N/A（参照性结论）。

### G-003 「搜索-发现-执行」MCP 工具面模式
- User problem: unvalidated hypothesis（AgenticX 当前单 MCP server 工具规模有限，无上下文淹没痛点）。
- Upstream evidence: E-003
- AgenticX current state: 每server 工具直出，规模可控。
- Actual gap: NO-GAP（现状无痛点）。
- Value: medium（原则借鉴）；Cost: medium；Regression risk: low
- Decision: P2
- Minimal adoption: 记录为设计原则：未来任一工具面 > 数百工具时采用发现型工具而非平铺。
- Scope boundary: 仅设计原则记录。
- Acceptance evidence: N/A。

### G-004 收割 1,579 provider 目录做市场卡片
- User problem: 无（是对用户诉求的过度延伸）。
- Upstream evidence: E-006（provider 非 MCP server，离网关不可安装）
- AgenticX current state: 市场卡片契约=可安装（A-3）。
- Actual gap: NO-GAP —— 制造不可安装的死胡同卡片会破坏市场契约，明确不做。
- Value: low；Cost: medium；Regression risk: high（信任损伤）
- Decision: NO-GAP（explicitly not doing）
- Minimal adoption: no implementation。
- Scope boundary: —
- Acceptance evidence: —。

### G-005 网关自身作为 MCP 客户端接入远端 provider（含限额守护）
- User problem: 无——AgenticX 已支持任意 MCP server 接入。
- Upstream evidence: E-013
- AgenticX current state: runtime 直连 MCP server（conclusions tools/protocols 条目）。
- Actual gap: NO-GAP（限额守护细节价值有限）。
- Decision: NO-GAP。

## Verdict derivation
- P0：无（G-001 完整闭环超两周；其余无 P0 条件）。
- P1：G-001（用户原话诉求 + local-source high + 已检查范围内代码级缺口 + 最小路径两周可验证）、G-002（Enterprise 轨道已验证方向）。
- 结论：**SELECTIVE_ADOPT**。
