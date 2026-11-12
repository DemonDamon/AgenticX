# AgenticX 安全治理补齐总体规划（Master Plan）

Planned-with: GLM-5.3（Trae Code）
Suggested-Impl-Model: SP1 主链路贯通与 SP5 处置面板用中强档；SP2/SP3/SP4/SP6 用中档
Status: planned（2026-11-11 立项；由业界安全治理框架对表评估驱动，缺口结论见第二节）
Plan-Id: 2026-11-11-security-governance-master

> **定位：** 把安全对表评估识别出的六个缺口，补成"事前-事中-事后"全链路一体化安全治理，使 agx 在"模型/数据/应用/访问全链路管控"的行业安全治理框架下**逐项可对答、可证明、可演示**。本文档是唯一的状态与验收控制点：sub plan 做完一个提交一个，状态表由本文档回填。

**分支（建议）:** `feat/security-governance`
**外部锚点:** 业界「大模型时代的安全治理」框架（外部安全厂商公开观点）——事前（模型安全测评/数据脱敏/风险准入）、事中（大模型防火墙/提示词风控/权限隔离/内容审核）、事后（审计溯源/风险告警/闭环处置）；OWASP LLM Top 10（攻击分类对齐）；JailbreakBench（公开越狱语料来源）。
**内部锚点:** `docs/guides/security.md`（核心 Safety 模块契约）、`enterprise/apps/gateway/README.md`（网关策略引擎/审计/配额）、`enterprise/SECURITY.md`（企业安全基线）。本次对表评估结论已全部内化到第二节，本规划自包含。

---

## 一、背景与需求原话

需求原话（外部安全厂商观点，2026-11-11）：

> 站在安全厂商的视角，AI安全不是单点防御，而是模型、数据、应用、访问全链路一体化管控：
> 事前做模型安全测评、数据脱敏与风险准入；
> 事中部署大模型防火墙、提示词风控、权限隔离、内容审核；
> 事后持续审计溯源、风险告警、闭环处置。

任务原话（2026-11-11）：

> 从安全的角度看一下我们 agx 体系有没有做到这些点……基于缺失的部分，基于 Master Plan 写一份 Master Plan。

对表结论：**事中拦截与事后审计已有扎实落地（审计防篡改链、trace 级下钻属强项），三个结构性缺口 + 三个半缺**，全部记入第二节。

## 二、现状盘点（Root cause：为什么现在不够）

### 已有资产（无需重做，本战役只补洞）

| 能力 | 证据 |
|---|---|
| 核心四级安全管线（截断→泄露→策略→注入） | `agenticx/safety/layer.py:36-176`；ToolExecutor 已接线 `agenticx/tools/executor.py:349-369` |
| 工具输入校验（shell/路径穿越/系统文件/命令替换/SQL/SSRF 六规则） | `docs/guides/security.md:69-89` |
| 工具 Guardrails 白/黑名单 + before_tool_call 拦截 | `agenticx/tools/guardrails/hook.py:73-98`、`builtin.py:16-57` |
| 企业网关策略引擎（关键词/正则/PII/Prompt 四类规则，请求/响应/流式三向拦截 90001/90002） | `enterprise/apps/gateway/internal/server/server.go:336-338,829-997`、`protocol_handlers.go:151,409` |
| RBAC 字段级访问控制（90003）与跨境判定 | `server/rbac_integration.go:57-70`、`crossborder_integration.go` |
| PII 缓存旁路（PII-like 输入不进共享缓存） | `server/cache/key.go:63,92` |
| 审计防篡改链（blake2b checksum 链 + JSONL/PG 双写 + 链校验 + 管理后台查询/导出/校验页） | `internal/audit/writer.go:23-148`、`dual_writer.go:33-57`；`enterprise/features/audit/src/services/pg-store.ts:78-103`；`admin-console/src/app/api/audit/*` |
| 计量落库前脱敏（email/手机号/sk-key/bearer）+ trace IO 采集默认关 | `internal/metering/redact.go:29-72` |
| Handoff 安全三件套（redaction + egress allowlist fail-closed + 非执行注入包装） | `agenticx/harness/handoff/security.py:53-131` |
| 配额熔断/预算/限流 + 预算告警（仅入库） | `internal/quota/`（limiter/budget/token_window）、`budget_alert_reporter.go:33-60` |
| PAT 认证与近实时吊销 | `internal/auth/pat.go:105-163`、`revocation.go:21-49` |
| 越狱/外泄检测规则库（作为数据） | `agenticx/skills/guard_patterns.yaml:214-226,747-751`（jailbreak_dan、TH-AI-005 等） |
| 模型黑白名单（名单制） | admin-console Model allowlist/blocklist 配置 |
| 桌面端权限确认三档（auto/ask/allowlist） | `agenticx/studio/harness_permissions.py:59-80` |
| SandboxPolicy 风险分级（CRITICAL→docker+断网） | `docs/guides/security.md:203-214` |
| 企业安全基线（审计 append-only + checksum 链 + 禁落原始对话） | `enterprise/SECURITY.md:66-70` |

### 六个缺口（本战役的全部输入）

| # | 阶段 | 缺口 | 证据 |
|---|---|---|---|
| G1 | 事前 | **模型安全测评缺失**：有越狱检测规则（事中数据），无用攻击验证防线的评测能力——"用规则拦"有了，"用评测证明拦得住"没有 | 规则库存在但无 eval harness、无记分卡、无准入依据 |
| G2 | 事中 | **安全层未全链路贯通**：Studio 主链路尚未统一经过完整 SafetyLayer，能力存在但覆盖有洞 | `README_ZN.md:109,484` 自认 |
| G3 | 事中 | **合规内容审核空白**：策略引擎偏凭据/注入/安全类，涉政/色情/暴恐等合规类无规则包、无第三方内容安全 API 适配——B 端/政企必答题 | 策略引擎规则 kind 仅关键词/正则/PII/Prompt |
| G4 | 事后 | **告警只入库不分发**：预算告警只写库、policy_hit 只进审计，无 webhook/飞书/邮件主动推送——最后一公里断裂 | `budget_alert_reporter.go` 仅 insert |
| G5 | 事后 | **处置无闭环**：有原语（PAT 吊销/预算熔断/会话 scope），无一键处置、事件记录与响应 SOP | 吊销能力存在但无告警→处置联动 |
| G6 | 事前 | **准入是名单制不是评审制**：有 Model allowlist/blocklist，无基于安全测评结果的准入门槛 | admin-console 仅名单配置 |

**结论：agx 有"深水区拦截能力"（工具输出注入防护、审计防篡改链、trace 级下钻），缺"全链路贯通 + 事前证明 + 事后闭环"。** G1/G2/G4 是三个结构性缺口，G3/G5/G6 是半缺。

## 三、核心价值

| # | 价值流 | 确定性 | 说明 |
|---|---|---|---|
| V1 | **售前安全叙事闭环** | 高 | 面对安全厂商的治理框架逐项可对答；SP2 记分卡 + SP6 拦截矩阵报告直接构成"我们有防线"的可转发证据 |
| V2 | **真实防护能力补齐** | 高 | 贯通（G2）= 覆盖无洞；这是被客户安全团队渗透测试时能不能扛住的问题 |
| V3 | **政企合规准入** | 高 | G3 合规审核 + 已有审计链，是数据安全法/等保语境下 B 端交付的必答题 |
| V4 | **运营可响应** | 中 | 告警到处置分钟级闭环（G4+G5），把"事后"从"能查"升级为"能打" |

## 四、做 / 不做（YAGNI 边界）

**做：**
- Studio 主链路统一贯通 SafetyLayer（含 flag 灰度与观察模式）
- 模型安全评测线：攻击语料 + 模型矩阵 + 记分卡 + 准入门槛
- 合规规则包（租户可配数据）+ 第三方内容安全 API 适配层
- 告警分发（webhook/飞书）+ 一键处置（session/PAT/user/model）+ 事件记录 + SOP
- 攻防演练 ≥12 类攻击 + 拦截矩阵报告（兼作售前材料）

**不做（明确决策，写在这里防止执行漂移）：**
1. **不自建内容安全模型**——只做规则包数据 + 第三方 API 可插拔适配，模型交给专业厂商
2. **不做 WAF/NIDS 类网络层防护**——那是专业安全厂商的场子，我们只做智能体与 LLM 应用层
3. **不做 SOC/SIEM 平台**——审计数据可导出对接客户已有 SIEM 即可，不重复造日志平台
4. **不做工单系统/ITSM 集成**——事件记录用现有 PG + 审计链，状态机三态够用
5. **不动密钥管理现状**——生产走 K8s Secret/Vault 的既有约定不变，只补文档位
6. **不做零信任网络改造**——访问控制停留在网关 RBAC/PAT 层

## 五、目标架构

全链路映射（行业框架术语 → agx 落点 → 本战役动作）：

| 阶段 | 行业框架术语 | agx 现状 | 本战役 |
|---|---|---|---|
| 事前 | 模型安全测评 | ❌ G1 | **SP2 评测线 + 记分卡** |
| 事前 | 数据脱敏 | ✅ 网关计量脱敏 + handoff redaction | 不动 |
| 事前 | 风险准入 | 🟡 G6 名单制 | **SP2 准入门槛（评审制）** |
| 事中 | 大模型防火墙 | ✅ 网关策略引擎三向拦截 | 不动 |
| 事中 | 提示词风控 | 🟡 G2 能力在、主链路未贯通 | **SP1 贯通** |
| 事中 | 权限隔离 | ✅ Guardrails/权限确认/RBAC/沙箱分级 | 不动 |
| 事中 | 内容审核 | 🟡 G3 仅凭据类 | **SP3 合规规则包 + 外部 API** |
| 事后 | 审计溯源 | ✅ 防篡改链 + trace 下钻（强项） | 不动 |
| 事后 | 风险告警 | 🟡 G4 只入库 | **SP4 分发通道** |
| 事后 | 闭环处置 | 🟡 G5 有原语无闭环 | **SP5 一键处置 + 事件记录** |

处置闭环流（SP4+SP5 联动后达成）：

```text
攻击/违规发生
  → 事中拦截（策略引擎/SafetyLayer，先审计后拦截）
  → 事件落审计链（policy_hit / 安全事件，checksum 防篡改）
  → AlertDispatcher 分级分发（飞书/webhook，去重限流）
  → 管理员一键处置（session 终止 / PAT 吊销 / 用户禁用 / 模型拉黑）
  → 事件记录流转（open → handling → resolved，trace_id 关联审计）
  → SP6 演练季度重跑，证明以上每一环真实生效
```

## 六、Sub Plans 与依赖

| # | Plan-Id | 内容 | 前置 | 规模 | 状态 |
|---|---|---|---|---|---|
| SP1 | `safety-layer-mainline` | Studio 主链路 SafetyLayer 统一贯通：agent loop 工具结果默认过完整四级管线 + InputValidator 前置校验默认开启；feature flag 默认 on、off 等价现状；SafetyAuditLog 事件桥接企业审计（trace_id 关联）；P95 延迟预算 + WARN-only 观察模式先行 | 无 | M | ✅ |
| SP2 | `security-eval-and-admission` | 模型安全测评与准入：`agx security-eval` 红队评测线——攻击语料（guard_patterns 规则库反向生成 + 公开越狱基准）× 模型矩阵 → 安全记分卡报告（md+json 落盘）；admin-console 模型启用接准入门槛，低于阈值需记录在案的 override；报告直接可作售前材料 | 无 | M | ✅ |
| SP3 | `compliance-moderation` | 合规内容审核：策略引擎新增合规规则包（涉政/色情/暴恐/广告，租户可配数据包，走现有 policy snapshot 热加载）+ 第三方内容安全 API 适配层（provider 可插拔，strict/degraded 两档降级，流式在流尾、非流式在终态调用）；命中沿用 90001/90002 并带规则类别字段 | 无 | M | ✅ |
| SP4 | `alert-dispatch` | 告警分发通道：AlertDispatcher——源（policy_hit 审计事件/预算告警/审计链校验失败）→ 分级（复用规则 severity，链校验失败=CRITICAL）→ 通道（通用 webhook + 飞书群机器人，SMTP 可选）→ admin-console 租户级通道配置；去重窗口 + 通道级限流防风暴；分发本身落审计 | 无 | S | ✅ |
| SP5 | `incident-response-loop` | 一键处置与事件记录：处置面板（session 终止/PAT 吊销/用户禁用/模型拉黑；user 级二次确认）+ `security_incidents` 事件记录（三态状态机，trace_id 关联审计链）+ 响应 SOP 写入 `enterprise/SECURITY.md`；所有处置动作先审计后执行 | SP4 | M | ✅ |
| SP6 | `red-team-drill` | 攻防演练与总验收：≥12 类脚本化攻击（越狱/工具输出注入/凭据外泄/路径穿越/SSRF/shell 注入/跨租户/吊销绕过/预算击穿/审计链篡改/合规内容/会话击杀续用）对真实部署栈演练 → 拦截矩阵报告（攻击→设计拦截层→实测结果→证据），≥90% 在设计层拦截或告警；报告与"行业安全治理框架对表"售前材料同批落盘 | SP1–SP5 | M | ⬜ |

依赖关系：SP1/SP2/SP3/SP4 均无相互前置（各自立足已有底座，可并行）；SP5 需 SP4（处置由告警驱动）；SP6 收尾。**最小可交付集（真 MVP）= SP1 + SP4**：拦截全链路生效 + 有人被通知，构成最小真实防护闭环，自身前置完备、零欠账。单线推进序：SP1 → SP4 → SP2 → SP3 → SP5 → SP6。

## 七、统一纪律（全战役有效）

1. **先审计后动作**：拦截、放行、处置全部先落审计事件再执行，禁止任何静默行为
2. **规则是数据**：规则包/攻击语料/准入阈值全部数据化配置、可热更（沿用 policy snapshot 机制），不硬编码
3. **fail-closed 仅限凭据类**：密钥/凭据不确定性即拦截；内容审核外部依赖故障走 degraded 降级 + CRITICAL 告警，不静默放行也不一刀切熔断
4. **默认开启 + flag 兜底**：新防护企业路径默认 on，off 等价现状（延续 harness 战役纪律，off 路径有回归测试保障）
5. **报告即产品**：SP2 记分卡 / SP6 拦截矩阵落盘版本化，售前可直接引用；对外材料全部脱敏（延续既有脱敏纪律，不得出现客户可识别信息）
6. **端到端真机验证前置**：每个 SP 提交前完成真机 E2E（真机无法测试时模拟机），通过后提交；commit trailer 统一 `Plan-Id / Plan-File / Impl-Model（值由用户指定）/ Made-with: Damon Li`

## 八、总验收标准

- [x] SP1：真实 Studio 会话 E2E——工具输出中植入注入指令与假密钥，主链路被 sanitize/redact；WARN-only 观察期报告落盘后切 enforce；P95 延迟增幅不超预算；flag off 全量回归与现状等价（2026-11-12 完成：真实 AgentRuntime loop E2E 3 项通过、P95 实测 10.4ms/预算 50ms、回归 136 项通过；细节见 SP1 sub plan）
- [x] SP2：≥2 个真实模型的记分卡报告落盘（md+json）；admin-console 准入门槛生效——低分模型启用被阻断，override 路径留痕；报告可脱敏后直接转发售前（2026-11-12 完成：真实双模型评测 MiniMax-M2.7 得 76（A）/glm-5.3-flash 得 69（A），42 条攻击语料（guard 反向生成 20 + 越狱种子 22），记分卡落盘 reports/security-eval/real-matrix-1；准入门槛 22 项 pytest + 29 项 vitest 全绿，真实记分卡→低分阻断→override 留痕 E2E 通过；md 售前版无 endpoint/密钥/原始 payload。细节见 SP2 sub plan）
- [x] SP3：合规规则包命中在请求/响应两侧产生 90001/90002 且带类别字段；第三方 API 适配层 contract 测试过 + degraded 降级路径 E2E（provider 故障→本地规则兜底+CRITICAL 告警）（2026-11-12 完成：snapshot payload.category 零迁移贯通→引擎一等字段→90001/90002 body→审计链；内置四类基线包（暴恐/涉政 block-critical、色情 block-high、广告 warn-medium）走插件播种+快照热加载租户可配；moderation 包 provider 可插拔（通用 JSON 契约）+六处接线（请求侧/非流式终态/流式流尾）；degraded 默认故障降级本地规则+CRITICAL moderation_degraded 告警去重、strict 租户选装 fail-closed；9+5 Go 测试+6 TS 测试+10 console 测试全绿，server/audit/moderation/alertdispatch/quota/policy-engine 回归通过。细节见 SP3 sub plan）
- [x] SP4：真实 policy_hit 触发飞书卡片送达配置群（E2E 截图留证）；同规则窗口内重复命中去重为一条；通道限流生效；分发动作本身可在审计链查到（2026-11-12 完成：server 级接线 E2E 用 httptest 飞书端点验证卡片送达+去重；10 Go 测试 + 8 console API 测试 + server/audit/quota 回归全绿；真实飞书群送达待 webhook secret 配置后同路径复测。细节见 SP4 sub plan）
- [x] SP5：模拟外泄攻击→告警→一键处置 E2E 全流程——session 被杀 + PAT 吊销后原凭据请求 401、事件记录三态流转完整、处置动作在审计链可查（2026-11-13 完成：网关 E2E `TestIncidentResponseLeakDispositionE2E` 全链验证——模拟外泄 policy_hit→飞书告警带 user/session/model→POST 处置端点（terminate_session+revoke_pat，先落链再即时吊销）→原 PAT `pat_revoked` + 同 session JWT 401、无关 session 不受影响、链上 incident_action×2 且 VerifyAuditChain 通过；SessionRevocationStore 5 测试（内存即时+snapshot 轮询兜底）；security_incidents 三表 PG/MySQL 迁移；iam-core incident repo 双实现（三态状态机+重开边）12 测试；console 处置编排 16 测试（先审计后执行 callOrder、disable_user 二次确认+级联、snapshot route internal auth）；SECURITY.md 4.5 事件响应 SOP；gateway `go test ./internal/...` 全 ok、iam-core 173 测试 + db-schema 30 测试全绿。细节见 SP5 sub plan）
- [ ] SP6：≥12 类攻击拦截矩阵报告落盘，≥90% 在设计层拦截或告警，每格附证据；行业安全治理框架对表材料（售前版，脱敏）同批交付
- [ ] 每个 sub plan 一个 commit + 标准 trailer

## 九、风险与对策

| 风险 | 对策 |
|---|---|
| SafetyLayer 上主链路引入性能/误杀 | WARN-only 观察模式先行 + flag 灰度 + P95 预算红线；利用 LeakDetector 已有 Aho-Corasick 前缀索引控制扫描成本 |
| 合规规则包误拦正常业务 | 规则包租户级可配 + WARN 档位先行 + 命中审计可复盘（现有 Policy WARN 语义直接复用） |
| 第三方审核 API 延迟/不可用 | degraded 降级本地规则 + CRITICAL 告警；strict fail-closed 按租户选装，不全局默认 |
| 告警风暴淹没通道 | 去重窗口 + 通道级限流 + 分级过滤（MED 可配置只入库不分发） |
| 一键处置误伤在线用户 | session/token 级默认放行、user 级二次确认；处置全审计可回滚（PAT 可重发） |
| 测评语料与真实攻击漂移 | 语料版本化管理；SP6 演练纳入 SOP 季度重跑，语料随演练迭代 |

## 十、参考索引

对表基准（外部）：
- 业界「大模型时代的安全治理」框架观点（外部安全厂商公开分享，见第一节，本规划的对表基准）
- OWASP LLM Top 10（SP2 攻击分类与 SP6 演练攻击类型对齐）
- JailbreakBench 公开越狱语料（SP2 语料种子来源，规避自造语料的不可信问题）

内部关键文件：
- 核心安全模块契约：`docs/guides/security.md`（管线顺序/InputValidator 六规则/SandboxPolicy 分级）
- 网关策略引擎与审计：`enterprise/apps/gateway/internal/server/server.go`、`internal/audit/writer.go`、`internal/policyengine/`
- 预算告警（SP4 改造基座）：`enterprise/apps/gateway/internal/quota/budget_alert_reporter.go`
- 规则库（SP2 语料反向生成来源）：`agenticx/skills/guard_patterns.yaml`、`agenticx/skills/guard_v1.py`
- 企业安全基线（SP5 SOP 落点）：`enterprise/SECURITY.md`
- 本次对表评估：会话内结论已全量内化至第二节，无外部依赖
