# Master Plan：补齐 OpenClaw 已验证、AgenticX 缺失的网关协议层能力

> 创建日期：2026-11-09
> 分支：`openclaw-capability-gap-master-plan`
> 状态：Plan（待评审）
> 上游调研：OAS 标杆分析第 8 章附录（飞书文档）+ OpenClaw 官方文档快照（docs.openclaw.ai，2026-11-09 检索）
> 影响代码面：`customers/AgenticX-HC/enterprise/apps/gateway`（Go，下称 EGW）与 `customers/AgenticX-HC`（agx gateway / Machi 客户端，Python/TS）

---

## 1. 背景与动机

在 OAS 标杆调研中，我们对 OpenClaw Gateway 与 AgenticX Enterprise Gateway（`customers/AgenticX-HC/enterprise/apps/gateway`，下称 EGW）做了逐维度对比。核心结论：

- **两者重合面小、互补性强**：OpenClaw Gateway 是「个人 Agent 的会话中枢」（聊天渠道 → Agent 的会话路由），EGW 是「企业 LLM API 治理数据面」（API 请求 → 多厂商模型的路由治理）。
- EGW 在企业信任与成本面上显著领先：policy-engine（PII/脱敏）、配额预算熔断、防篡改审计链（blake2b）、语义缓存、Wasm 插件链、跨境驻留、key pool 轮转、Reserve/Settle/Rollback 流式计费——OpenClaw 全部没有。
- 但 OpenClaw 在**协议层与信任仪式**上有一批经过大规模个人部署验证的设计，EGW 目前没有。这些不是「企业治理」的替代品，而是让网关从「无状态代理」升级为「有生命周期的执行面」的骨架。

本 Plan 只做一件事：**把 OpenClaw 已验证、AgenticX 确认缺失的六项协议层能力，按依赖顺序规划落地到 EGW（Go）与 AgenticX-HC 仓的 `agx gateway` 客户端（Python）。**

## 2. 非目标（明确不抄什么）

| 不抄项 | 理由 |
|--------|------|
| 记忆系统（MEMORY.md / 双路召回） | AgenticX 已有完整实现：memory graph、workspace_memory、session_memory、memory_hook（`customers/AgenticX-HC/agenticx/memory/`），且形态比 Markdown 文件更适合企业多租户 |
| 单主机个人信任模型 | OpenClaw 安全模型建立在「这台机器是我的」；EGW 的 PAT + JWT + session grants + 吊销列表是企业级更强的信任，保留不动 |
| Baileys 渠道会话主权不变量（每主机单 WhatsApp 会话） | 飞书/企微 webhook 是无状态回调，天然规避该问题。仅当未来接入 WhatsApp 等有状态渠道协议时再评估 |
| MCP 客户端视角 | AgenticX 是 MCP host + proxy 服务端视角（含审计/限速），比 OpenClaw 客户端视角更完整 |
| OpenClaw 的模型路由/agent loop | EGW 三路由决策 + channel pool 已覆盖且更企业化 |

## 3. 现状盘点（借鉴基线）

**EGW 已有（本 Plan 的落地面）**：三路由决策（local/private-cloud/third-party）、policy-engine、quota/budget/熔断、audit 防篡改链（File+PG 双写 + blake2b）、cache（L1 LRU + L2 语义）、Wasm 插件链（请求/响应/stream-chunk 钩子）、MCP host+proxy、residency 判定（含 `require_approval`）、channel/keypool 轮转、billing Reserve/Settle/Rollback、PAT/session grants/revocation、`trace_context.go`（Trace-id/Step 头 → identity）、优雅降级、admin-console 5-10s 热加载。

**AgenticX-HC 仓 `agx gateway`（IM 远程指令网关）已有**：飞书/企微 webhook 接入、WS 本机客户端（`agx serve`）、`device_id` 静态配置（`~/.agenticx/config.yaml`）。

**OpenClaw 调研材料**：`research/OpenViking/docs`（OpenClaw 中文文档快照，含 Gateway 架构/沙箱/记忆页）、docs.openclaw.ai 检索记录（2026-11-09）。

## 4. 六大能力缺口详析

> 每项按「OpenClaw 机制 → AgenticX 现状 → 差距 → 目标设计」组织。事实均已在调研中核对。

### G1. runId 请求状态机 + 幂等键协议

- **OpenClaw**：`agent` 方法受理即返回 `{runId, status:"accepted"}`；此后所有流式事件与最终结果（`{runId, status, summary}`）均携带同一 runId；带副作用的方法（`send`、`agent`）**强制幂等键**，服务端维护短期去重缓存，重试安全。
- **AgenticX 现状**：`trace_context.go` 仅把 Trace-id/Step 头解析为 identity 透传；审计有 trace_id 关联（`0022_gateway_audit_trace_id.sql`）；但 SSE 流没有显式的「受理 → 流式中 → 终态」状态机，客户端无法凭一个 ID 查询请求状态；billing Reserve/Settle/Rollback 无请求级幂等去重——**网络重试可能导致双结算**；MCP proxy 转发无幂等语义。
- **差距本质**：EGW 的请求生命周期对客户端不可见、不可查、不可安全重试。
- **目标设计**：
  - 网关为每个 chat/MCP 请求签发 `run_id`（服务端生成，见 ADR-1），响应头 `X-Run-Id` + 状态查询端点 `GET /v1/runs/{run_id}`（accepted/streaming/completed/failed/cancelled）。
  - SSE 事件与 usage 上报均携带 run_id；audit 事件关联 run_id（复用现有 trace_id 链路）。
  - 副作用端点强制 `Idempotency-Key`：billing 结算、MCP proxy 转发。Redis SETNX 去重（TTL 10min），与 quota tracker 的 remote 缓存模式一致。纯 chat 推理不强制（见 ADR-5）。

### G2. Human-in-the-loop 审批闭环

- **OpenClaw**：session permission modes + 高危动作挂起等待批准 + 审批记录持久化（设备配对审批同机制）。
- **AgenticX 现状**：`residency/judge.go` 的 `require_approval` 只置 `res.PendingApproval = true` 标记位——**挂起后发生什么没有闭环定义**；policy-engine 只有自动 allow/block。
- **差距本质**：判定有了，「等待人类、恢复执行」的状态机没有。跨境合规场景出 `require_approval` 时请求实际行为未定义。
- **目标设计**：
  - 新增 `approvals/` 包：ApprovalRequest 实体（挂起表 PG + Redis TTL），请求进入 `pending_approval` 状态（挂起即断开响应连接，不占连接池，恢复凭 run_id 重放，见 R1）。
  - admin-console 新增审批队列 UI（扩展 CompliancePanel）：批准 → 放行/重放；拒绝 → 终止并回复拒绝原因；超时策略可配（默认 reject）。
  - 审批决策（谁、何时、批/拒、理由）写入现有 blake2b 审计链。
  - 触发点收敛为三个：residency 判定 `require_approval`、Wasm 插件返回 `require_approval`、policy-engine 规则声明升级为审批。
  - 依赖 G1：挂起的请求必须能凭 run_id 追踪与恢复。

### G3. WS typed API 统一事件协议

- **OpenClaw**：WS 单端口承载三帧型协议——`req`（`{type,id,method,params}` → `res`（`{type,id,ok,payload|error}`）+ `event`（`{type,event,payload,seq?,stateVersion?}`）；入站帧 JSON Schema 校验；`connect` 首帧强制 → `hello-ok` 返回能力发现元数据（`features.methods/events`）；事件不重放、客户端检测 seq 缺口后刷新；协议由 TypeBox schema 代码生成（TypeBox → JSON Schema → Swift 模型）。
- **AgenticX 现状**：EGW 是 HTTP 请求 + SSE 单向推送（无能力发现、无事件序列、无帧校验）；AgenticX-HC 仓 `agx gateway` 有 WS 但协议无 schema、无能力发现、无事件序号。
- **差距本质**：两套网关（Go EGW、Python agx gateway）没有共享的、可演进的 typed 协议；事件无法按序消费、无法感知缺口。
- **目标设计**：
  - 定义 **AgenticX Wire Protocol v1**（`customers/AgenticX-HC/enterprise/packages/wire-protocol/`）：connect → hello-ok（能力发现）→ req/res/event 三帧；帧 schema 用 JSON Schema 单一事实源，Go/Python 双端代码生成。
  - EGW 新增 `/ws` 端点（与 SSE 并存灰度，见 ADR-3）；`agx gateway` 客户端升级到同一协议。
  - 事件帧携带 `seq` + `stateVersion`；沿用 OpenClaw 不变量：**事件不重放，缺口须刷新**。
  - run/trace/审批事件（G1/G2）优先走该通道，SSE 保持兼容。

### G4. 设备配对信任模型

- **OpenClaw**：所有 WS 客户端（操作员+节点）在 `connect` 中携带设备身份；新设备需**配对审批** → 签发设备令牌；每次连接对 `connect.challenge` nonce 签名，签名载荷绑定 platform/deviceFamily，元数据漂移触发重新配对；本地 loopback 自动批准、非本地必须显式批准。
- **AgenticX 现状**：`device_id` 是配置文件里的静态字符串（如 `my-macbook`），无配对审批、无挑战签名、无令牌轮换——**任何知道 URL 的人可以自称任意 device_id 接入**。
- **差距本质**：IM 远程指令网关的客户端信任是「配置声明式」而非「配对验证式」。
- **目标设计**：
  - 设备注册流：首次连接 → 进入待审批队列 → admin-console 批准 → 签发设备令牌（短期，可轮换）→ 客户端持久化。
  - 每次连接执行挑战 nonce 签名（载荷绑定 device_id + platform + client version）。
  - 设备令牌与 PAT 正交（见 ADR-4）：设备令牌是「这台机器是谁」，PAT 是「这个用户/服务是谁」。
  - 兼容期：legacy 静态 device_id 允许接入但审计告警（见 R3）。

### G5. 节点能力声明与命令路由

- **OpenClaw**：节点（macOS/iOS/Android/无头设备）以 `role:node` 接入，`connect` 中声明能力命令（`canvas.*`、`camera.*`、`screen.record`、`location.get`）；网关据此路由命令到目标节点；配对审批记录按设备存储。
- **AgenticX 现状**：`agx serve` 本机客户端没有能力声明概念；网关无法知道哪台设备能执行什么指令——远程指令网关只是消息中继，不是设备编排面。
- **差距本质**：缺「设备能做什么」的注册与路由层。
- **目标设计**：
  - Wire Protocol v1 的 `connect` 帧增加 `capabilities` 字段（命令清单 + 版本）；网关维护设备能力路由表。
  - 能力变更事件（节点上线/离线/能力更新）广播给订阅方。
  - 为「IM 远程指令网关 → 企业设备编排网关」的演进铺路（与 OAS「让 Agent 能办」的通信动作路由同构——未来 OAS 号码动作可复用同一路由层）。
  - 依赖 G3（协议）+ G4（设备信任）。

### G6. 画布主机（远期 backlog）

- **OpenClaw**：`/__openclaw__/canvas/` 托管智能体可编辑的 HTML/CSS/JS 画布（同端口复用 Gateway HTTP 服务器）。
- **AgenticX**：无对应物。
- **定位**：远期。若 web-portal 需要服务端渲染 Agent 产物的受控预览层，评估「受控 iframe 沙箱 + CSP 白名单」形态，复用 EGW 同端口托管。不进入本轮 Phase。

## 5. 分阶段实施计划

> 原则：每个 Phase 独立可交付、可验收、可灰度；先协议骨架后编排能力。

### Phase 1 — runId 状态机 + 幂等结算（对应 G1）

| 项 | 内容 |
|----|------|
| 改动面 | `server/`（run middleware、`/v1/runs/{id}`）、`billing/`（幂等结算）、`quota/`（去重窗口）、`audit/`（run 关联）、db-schema（runs 表迁移） |
| 交付物 | X-Run-Id 响应头；SSE 事件携带 run_id；幂等键去重（billing + MCP proxy）；run 状态查询端点 |
| 验收标准 | ① 同 Idempotency-Key 的重复结算请求 10 分钟内只结算一次（集成测试）② SSE 事件与审计事件可按 run_id 聚合查询 ③ `/v1/runs/{id}` 返回完整状态机（accepted/streaming/completed/failed/cancelled）④ run 落库为异步（Redis 先行，PG 批量落，压测不放大写路径） |
| 依赖 | 无 |
| 里程碑 | M1 |

### Phase 2 — 审批闭环（对应 G2）

| 项 | 内容 |
|----|------|
| 改动面 | 新 `approvals/` 包、`residency/`（挂起接入）、`server/crossborder_integration.go`、policy-engine 触发点、admin-console CompliancePanel、db-schema（approval_requests 表） |
| 交付物 | 挂起状态机（pending → approved/rejected/expired）、admin 审批队列 UI、审批决策入审计链、Wasm 插件 require_approval 触发点 |
| 验收标准 | ① residency 判 require_approval 的请求真实挂起（不 block 不放行）② admin-console 可批准/拒绝，批准后请求凭 run_id 恢复放行 ③ 审批决策（操作者/时间/理由）进 blake2b 审计链 ④ 超时默认 reject 且可配 ⑤ 挂起请求不占用连接池 |
| 依赖 | Phase 1（run_id 追踪与恢复） |
| 里程碑 | M2 |

### Phase 3 — Wire Protocol v1：WS typed 事件协议（对应 G3）

| 项 | 内容 |
|----|------|
| 改动面 | 新 `packages/wire-protocol/`（JSON Schema 事实源 + Go/Python 代码生成）、EGW 新 `ws/` 包（连接管理、帧校验、事件分发、seq/stateVersion）、`agx gateway` 客户端协议升级 |
| 交付物 | connect/hello-ok 握手 + 能力发现、req/res/event 三帧、事件 seq 递增与缺口检测、SSE/WS 双通道灰度开关 |
| 验收标准 | ① WS 帧过 JSON Schema 校验（非法帧关闭连接）② 事件按 seq 递增，客户端可检测缺口并刷新 ③ 断线重连后 stateVersion 校验语义正确 ④ SSE 与 WS 灰度开关生效，回归不影响现有 web-portal ⑤ Go/Python 双端 schema 由同一事实源生成 |
| 依赖 | 建议 Phase 1 先行（事件帧需要 run_id 字段定义） |
| 里程碑 | M3 |

### Phase 4 — 设备信任 + 节点能力（对应 G4 + G5）

| 项 | 内容 |
|----|------|
| 改动面 | EGW `auth/`（设备令牌验证、挑战签名）、`agx gateway` 客户端（Python 配对流）、Machi 设置界面、admin-console 设备管理页、db-schema（devices 表） |
| 交付物 | 设备注册→审批→令牌签发流、挑战 nonce 签名验证、能力声明路由表、能力变更事件广播、legacy device_id 兼容期告警 |
| 验收标准 | ① 新设备无审批不可执行指令 ② 挑战签名失败拒绝连接 ③ 命令按能力路由表送达目标节点 ④ legacy 静态 device_id 接入产生审计告警 ⑤ 设备令牌吊销后立即失效 |
| 依赖 | Phase 3（协议） |
| 里程碑 | M4 |

### 远期 Backlog

- G6 画布主机（受控 iframe 沙箱评估）
- WhatsApp 等 IM 有状态渠道接入时的会话主权不变量
- run 事件外发 webhook（对齐 OAS 附录「定时任务 + Webhook 值班闭环」）

## 6. 架构决策记录（ADR 摘要）

**ADR-1：run_id 由网关签发，客户端不可自带。** 网关是策略执行点，客户端生成的 ID 不可信（同 OAS 附录问题二结论：身份必须走基础设施通道，不走参数自声明）。

**ADR-2：审批挂起实现在网关层（approvals 包），不进 policy-engine。** 挂起需要跨请求生命周期（持久化挂起表 + 恢复重放），policy-engine 保持无状态纯函数判定；residency judge 维持只出判定值。

**ADR-3：WS 与 SSE 双通道并存，配置灰度。** web-portal 深度依赖现有 SSE；WS 新协议独立灰度，schema 演进以 wire-protocol 包为单一事实源。

**ADR-4：设备令牌与 PAT 正交。** 设备令牌回答「这台机器是谁」（配对审批签发），PAT 回答「这个调用方是谁」（admin 签发）；设备令牌作用域可被 PAT 持有者吊销，反向不成立。

**ADR-5：幂等键仅强制副作用端点（billing 结算、MCP 工具转发），chat 推理不强制。** chat 是可重复的读语义（重试代价是 token 计量而非资损）；双结算与重复工具副作用才是真资损。网关对 MCP proxy 调用自动补生成幂等键（见 R4）。

## 7. 风险与缓解

| # | 风险 | 缓解 |
|---|------|------|
| R1 | 审批挂起占满 SSE 连接池 | 挂起即断开响应连接，批准后凭 run_id 重放恢复（Phase 1 的状态查询端点即恢复入口） |
| R2 | Wire Protocol 双端改造跨仓跨语言（Go/Python） | schema 先冻结再并行实现；双端契约测试（同一 schema 生成 fixture） |
| R3 | 设备配对改变现有 `agx serve` 用户接入习惯 | legacy 静态 device_id 兼容期保留 + 审计告警；Machi 设置界面引导迁移 |
| R4 | 客户端不传幂等键 | 副作用端点由网关强制生成并回写响应头；缺省键 = 请求指纹（method+body hash）兜底 |
| R5 | runs 表写入放大拖慢热路径 | Redis 先行 + 异步批量落 PG，复用 quota tracker 已验证的 remote 缓存模式 |
| R6 | 与 OpenClaw 语义漂移（本文引用基于 2026-11-09 快照） | 落地各 Phase 前复核 docs.openclaw.ai 对应页面；差异记录回本 Plan |

## 8. 里程碑总览

```
M1 runId+幂等 ──► M2 审批闭环 ──► M3 Wire Protocol ──► M4 设备信任+节点能力 ──► backlog(画布/webhook)
   (EGW Go)         (EGW+admin)       (EGW+agx gateway)     (EGW+Python+Machi)
```

- 每个里程碑独立可验收、可灰度发布；M2-M4 各自只有前序里程碑一个硬依赖。
- 本 Plan 不改动模型路由、policy-engine 判定逻辑、计费定价——只加协议层骨架，不动企业治理内核。

---

*本 Plan 基于以下证据：OpenClaw 官方文档（Gateway 架构/协议/沙箱页，2026-11-09 检索）；EGW 源码与结论文档（`customers/AgenticX-HC/enterprise/conclusions/apps/gateway_conclusion.md`，2026-07-21 重生成版）；AgenticX-HC 仓 `docs/gateway/im-remote-gateway-setup.md`；`residency/judge.go` 源码核对（`ActionRequireApproval` 仅置 `PendingApproval` 标记）。*
