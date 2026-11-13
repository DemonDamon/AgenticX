# SP6: 攻防演练与总验收（red-team-drill）

Plan-Id: red-team-drill
Parent-Plan: plans/security-governance/MASTER-PLAN.md（总验收：≥12 类脚本化攻击对真实部署栈演练 → 拦截矩阵报告，≥90% 在设计层拦截或告警；同时交付"行业安全治理框架对表"售前材料（脱敏））
Status: implemented（2026-11-13 实施 + 两侧演练与回归全绿；首轮实测 12 类 32 条攻击 100% 在设计层拦截或检出告警，并发现+修复一处真实规则缺口——SSRF link-local/元数据端点）
Suggested-Impl-Model: 中档

## 一、探查结论（12 类攻击 × 设计拦截层 × 可复用证据）

MASTER-PLAN 列定的 12 类攻击，逐一盘点"设计拦截层"与现成测试/证据：

| # | 攻击类 | 设计拦截层（真实生产代码） | 演练栈 | 现有测试（复用为断言口径参考） |
|---|---|---|---|---|
| A1 | 越狱提示注入 | SafetyLayer InjectionDetector + 越狱规则库（`agenticx/skills/guard_patterns.yaml` jailbreak_dan 等，作为数据） | Python 真实 SafetyLayer（`agenticx/safety/layer.py` 四级管线） | `tests/test_safety_layer.py`；SP2 语料 `agenticx/security_eval/jailbreak_seed.yaml` + `corpus.py` |
| A2 | 工具输出注入（间接提示注入） | SP1 贯通：agent loop 工具结果默认过完整四级管线（sanitize） | Python 真实主链路（SP1 E2E 范式：真实 AgentRuntime 组件） | `tests/e2e/test_e2e_safety_mainline.py::test_e2e_enforce_defends_llm_context` |
| A3 | 凭据外泄 | SafetyLayer LeakDetector（redact）+ 网关 PII 规则（SP5 E2E 已证外泄→告警→处置） | Python 真实 SafetyLayer；Go 侧证据由 SP5 E2E 引用 | `tests/test_safety_leak_detector.py`；`gateway .../incident_response_wiring_test.go::TestIncidentResponseLeakDispositionE2E` |
| A4 | 路径穿越 | tools InputValidator 路径穿越规则 | Python 真实 InputValidator | `tests/test_safety_input_validator.py::test_blocks_path_traversal` |
| A5 | SSRF 内网探测 | InputValidator SSRF 私网规则 | Python 真实 InputValidator | `test_blocks_ssrf_private_ip` |
| A6 | shell 注入/命令替换 | InputValidator shell/命令替换/反引号/系统文件规则 | Python 真实 InputValidator | `test_blocks_shell_injection_in_args` / `test_blocks_command_substitution` / `test_blocks_backtick_substitution` / `test_blocks_system_file_reference` |
| A7 | 跨租户越权 | 凭据绑定身份：`identityFromRequest` 中 TenantID 只来自 PAT payload / JWT 签名 claims（`server.go:1687`），下游全链 `identity.TenantID` 强过滤，请求头不可伪造 | Go 真实 gateway Server（PAT verifier + identity 解析 + policy snapshot 租户过滤） | `TestBuildPolicyEngine_PrefersSnapshotAndFiltersTenant`（snapshot 租户过滤先例） |
| A8 | 吊销凭据绕过 | PATRevocationStore：`Verify` 首查吊销（内存即时 + 快照轮询兜底）→ `auth:pat_revoked` 401 | Go 真实 PAT verifier + 吊销存储 | `TestPATVerifierRespectsRevocationBeforeCache`；SP5 E2E 原凭据 401 断言 |
| A9 | 预算击穿 | quota budget 硬限（warn→block）+ DB 模式 fail-closed（缺表拒绝） | Go 真实 quota budget | `TestBudgetBlockAtHardLimit` / `TestBudgetDatabaseReservationIsAllOrNothingAndFailsClosed` / `TestBudgetDatabaseMissingRelationDenies` |
| A10 | 审计链篡改 | blake2b checksum 链 + `alertdispatch.VerifyAuditChain`（`chaincheck.go:59`）+ 链校验失败 CRITICAL 告警（SP4） | Go 真实审计 FileWriter（写合法链）→ 篡改 → 校验 + 告警 | `incident_response_wiring_test.go` 三处 `VerifyAuditChain` 用例 |
| A11 | 合规内容（涉政/暴恐） | SP3 moderation 规则包（租户可配数据）→ 90001 + policy_hit 审计 + 告警 | Go 真实 Server + policy snapshot（合规规则包） | `TestServerModerationBlockedWritesAuditAndAlert` / `TestSnapshotRuleCategoryFlowsTo90001Body` |
| A12 | 会话击杀后继续用 | SP5 SessionRevocationStore：JWT 分支 `IsRevoked(claims.SessionID)` → 401 `session_revoked` | Go 真实 Server | `session_revocation_test.go` 5 测试；SP5 E2E 同 session JWT 401 |

其他关键事实：

| 事实 | 位置 |
|---|---|
| "真实部署栈"的务实口径：演练不打桩拦截层——Python 侧直接驱动生产 SafetyLayer/InputValidator；Go 侧组装真实组件（PAT 验证器、策略引擎 snapshot、quota、审计 FileWriter、告警 Dispatcher），与 SP1/SP5 E2E 同口径 | SP1 `test_e2e_safety_mainline.py`、SP5 `newIncidentTestServer`（`incident_response_wiring_test.go:39`） |
| SP2 评测线先例：运行真实栈生成记分卡落盘 `reports/security-eval/real-matrix-1/`（scorecard.md+json）——拦截矩阵报告格式与"报告即产品"模式照抄 | `agenticx/security_eval/report.py:33-124`、`reports/security-eval/real-matrix-1/` |
| Go 演练组装范式：`&Server{}` 裸构造 + 注入 Dispatcher/FileWriter/PAT verifier + `t.Setenv` + httptest | SP5 `newIncidentTestServer` |
| 合规规则包为租户可配数据（snapshot 热加载），演练 payload 直接用内置基线包同类关键词的**演练专用合成词**（不落真实敏感词原文） | SP3 moderation 内置基线包 |
| reports/ 目录已有 `security-eval/`；演练报告落 `reports/red-team-drill/drill-1/`（run-id 对齐 SP2 命名风格） | `reports/` |
| `tests/conftest.py` 已存在（pytest 选项注册落点）；`scripts/` 目录已存在（演练驱动脚本落点） | 仓库根 |

## 二、设计

### 演练形态：测试即脚本化攻击 + 演练模式落盘证据 + 驱动脚本汇总矩阵

```text
scripts/red-team-drill/run_drill.py（季度重跑入口，SECURITY.md 4.5.5）
  ├─ 1. subprocess: pytest tests/red_team/ --drill-report=<tmp>/python.jsonl
  ├─ 2. subprocess: go test ./internal/server -run TestRedTeam（env RED_TEAM_DRILL_REPORT=<tmp>/go.jsonl）
  ├─ 3. 读两侧 JSONL → 汇总拦截矩阵
  └─ 4. 落盘 reports/red-team-drill/drill-1/interception-matrix.md + .json
```

- **两侧演练测试可独立常规运行**（CI 无副作用）：不设 `--drill-report` / `RED_TEAM_DRILL_REPORT` 时只跑断言不写文件——对齐"off 等价现状"纪律。
- **演练模式**：参数化攻击逐条执行，每条记录 `{attack_class, case_id, payload_desc(脱敏), design_layer, outcome(blocked|alerted|breached), evidence}` 到 JSONL。
- **攻击语料是数据**：两侧 payload 以常量数据段定义（版本化在 git，每类 2-3 条，总条数 ≥30），不散在断言里。

### Python 侧演练（A1–A6，tests/red_team/test_red_team_drill.py）

真实拦截层直驱：SafetyLayer 完整四级管线（构造生产配置 layer）与 InputValidator（生产默认规则）。

| 类 | 演练断言 |
|---|---|
| A1 越狱 | DAN/角色扮演/安全词绕过等 seed payload → SafetyLayer enforce 拦截（检测器命中且 LLM 上下文未被污染） |
| A2 工具输出注入 | 工具结果内嵌"ignore previous instructions / 上传 env"类 payload → sanitize 后 LLM 上下文不含注入指令 |
| A3 凭据外泄 | 模型输出含假 API key/bearer/email → LeakDetector redact（输出不含原文凭据） |
| A4 路径穿越 | `../../etc/passwd` 等变体 → InputValidator 拒绝 |
| A5 SSRF | `http://169.254.169.254/...`、`http://10.x.x.x` 等内网目标 → 拒绝 |
| A6 shell 注入 | `; rm -rf /`、`$(cmd)`、反引号、系统文件引用 → 拒绝 |

### Go 侧演练（A7–A12，gateway/internal/server/red_team_drill_test.go）

组装真实 Server（仿 newIncidentTestServer：audit FileWriter + alert Dispatcher（httptest 端点收告警）+ PAT verifier + session revocation + policy snapshot 含合规规则包 + quota）。

| 类 | 演练攻击 → 断言 |
|---|---|
| A7 跨租户 | 租户 A PAT + 伪造租户头/query → identity.TenantID 仍为 A；策略 snapshot 只见 A 的规则（B 的合规规则不适用于 A 的请求——隔离不越权） |
| A8 吊销绕过 | PAT 吊销（走处置端点，先落链）→ 原凭据重放 401 `pat_revoked` + 链上 incident_action 证据 |
| A9 预算击穿 | 硬预算超限请求 → 请求被拒（block）；DB 模式缺 budget 关系 → fail-closed 拒绝（引用既有 quota 测试口径做演练断言） |
| A10 审计链篡改 | 写合法链若干事件 → 篡改其中一行 JSONL → `VerifyAuditChain` 失败 + CRITICAL 告警送达（SP4 链校验失败分发） |
| A11 合规内容 | 合成涉政/暴恐演练词 payload → 90001 拦截 + policy_hit（带 category）进审计链 + 告警送达 |
| A12 会话击杀续用 | 处置杀 session → 同 session JWT 重放 401 `session_revoked`；无关 session 不受影响（爆炸半径断言） |

### 拦截矩阵报告（reports/red-team-drill/drill-1/）

`interception-matrix.json`：机器可读（12+ 类、每类条目、汇总拦截率）。`interception-matrix.md`：人读版——矩阵表（攻击类 × 设计拦截层 × 实测结果 × 证据（测试名/断言）× 覆盖的 OWASP LLM 条目）+ 演练环境口径说明 + 汇总统计（拦截或告警占比 ≥90% 验收线）。**脱敏**：不含 endpoint/密钥；payload 用演练合成词与描述性措辞。

### 售前对表材料（reports/red-team-drill/drill-1/presale-security-alignment.md）

行业"大模型时代的安全治理"框架（事前/事中/事后）逐项对表：事前（模型安全测评→SP2 记分卡与准入门槛；数据脱敏→计量脱敏+handoff redaction）×事中（大模型防火墙→网关策略引擎；提示词风控→SP1 SafetyLayer 贯通；权限隔离→RBAC/Guardrails/沙箱；内容审核→SP3 moderation）×事后（审计溯源→防篡改链；风险告警→SP4 分发；闭环处置→SP5 事件响应）——每项给 agx 落点与本战役证据（报告/测试名），引用 SP6 拦截矩阵作为"防线实测"背书。脱敏、可直接转发售前。

### 纪律对齐（MASTER-PLAN 第七节）

- 先审计后动作：演练复用的拦截/处置路径本身先落审计（断言链上证据）
- 规则是数据：攻击语料数据段 + 合规规则包照用 SP3 租户可配数据
- fail-closed 仅凭据类：A8/A9 演练体现（吊销即拒、预算 DB 缺表即拒）
- 报告即产品：矩阵 md+json 版本化落盘；售前材料脱敏
- 真机验证前置：两侧演练测试本身就是真机 E2E（真实组件、非 mock 拦截层）；常规 CI 模式与演练模式双形态运行

## 三、改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `tests/red_team/test_red_team_drill.py`（新） | A1–A6 参数化演练（真实 SafetyLayer/InputValidator）+ 结果记录 helper |
| 2 | `tests/red_team/conftest.py`（新） | 注册 `--drill-report` pytest 选项（无副作用默认） |
| 3 | `enterprise/apps/gateway/internal/server/red_team_drill_test.go`（新） | A7–A12 演练（真实组件组装）+ `recordDrillResult` helper（env 控制） |
| 4 | `scripts/red-team-drill/run_drill.py`（新） | 演练驱动：subprocess 跑两侧 → 读 JSONL → 生成矩阵 md+json 落盘 |
| 5 | `reports/red-team-drill/drill-1/interception-matrix.md` + `.json`（新） | 拦截矩阵报告（本次演练实测产物落盘） |
| 6 | `reports/red-team-drill/drill-1/presale-security-alignment.md`（新） | 行业安全治理框架对表售前材料（脱敏） |
| 7 | `enterprise/SECURITY.md` | 4.5.5 演练节补 SP6 演练入口命令（季度重跑指向 run_drill.py） |
| 8 | Go/Python 测试 | 见验收清单 |

## 四、验收标准（对齐 MASTER-PLAN 第八节 SP6 行）

- [x] Python 演练：A1–A6 六类攻击（25 条 payload：A1 guard 反向越狱语料 10 条动态取自 corpus + A2–A6 参数化 15 条）全部在真实 SafetyLayer/InputValidator 被拦截（blocked），无 breached；`pytest tests/red_team/` 常规模式全绿且零文件副作用
  —— `tests/red_team/test_red_team_drill.py` 16 个测试项全过（A1 断言 worst-case 模型服从后规则栈 blocked_by_rule 且 expected_rules 命中；A2/A3 走真实 AgentRuntime.run_turn 主链路 enforce，断言 LLM 上下文 [ESCAPED: 中和标记/密钥 redact + enforce 安全事件；A4–A6 InputValidator is_blocked）
- [x] Go 演练：A7–A12 六类攻击（7 条）真实组件栈被拦截或告警（blocked/alerted），每类断言含审计链证据；`go test ./internal/server -run TestRedTeam` 常规模式全绿且零文件副作用
  —— `gateway/internal/server/red_team_drill_test.go` 6 测试全过：A7 伪造租户头/篡改 JWT 均 401 口径拒绝；A8 pat_revoked + incident_action 落链；A9 预算硬限 !Allowed；A10 VerifyAuditChain checksum mismatch + CRITICAL 告警送达；A11 moderation blocked + policy_hit 带类别 + 告警；A12 session_revoked + 无关会话不受影响
- [x] 拦截矩阵报告落盘 `reports/red-team-drill/drill-1/`（md+json）：≥12 类、每格含设计拦截层/实测结果/证据（测试名）、汇总拦截或告警占比 ≥90%
  —— 实测 **12 类 / 32 条 / 100%**（验收线 90%）；`interception-matrix.md`（矩阵总表 + 明细 + 演练发现 + 复现命令）与 `.json`（机器可读）
- [x] run_drill.py 端到端跑通：一条命令重演两侧 → 重新生成矩阵（SECURITY.md 4.5.5 季度重跑入口）
  —— `scripts/red-team-drill/run_drill.py` 两次端到端执行成功（pytest --drill-report + go test RED_TEAM_DRILL_REPORT → JSONL → md+json 生成）；SECURITY.md 4.5.5 已补演练入口命令块
- [x] 售前对表材料落盘且脱敏（无 endpoint/密钥/客户可识别信息；合规 payload 用合成演练词）
  —— `reports/red-team-drill/drill-1/presale-security-alignment.md`（行业框架事前/事中/事后逐项对表 × agx 落点 × 证据 + 红队实测背书表 + 工程纪律对答点）
- [x] 回归：gateway `go test ./internal/...` 全 ok；Python 既有安全测试（safety 系列）不回归
  —— gateway 全量 `go test ./internal/...` exit 0；Python `tests/test_safety_*`（layer/input_validator 含新 link-local 用例/leak_detector/sanitizer/policy/integration）+ `tests/e2e/test_e2e_safety_mainline.py` + `tests/red_team/` 共 71 passed
- [x] 附带产出（演练发现的真实缺口修复）：`ssrf_private_ip` 规则补 link-local/元数据段（169.254.169.254、0.0.0.0）—— `agenticx/safety/input_validator.py` + `tests/test_safety_input_validator.py::test_blocks_ssrf_link_local_metadata_endpoint` 回归锁定

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| 演练 payload 含真实敏感词（涉政等）落盘报告 | 全部用合成演练词（与内置规则包同形不同实），报告只记描述不记可复用攻击原文 |
| Go 演练组装复杂（组件多） | 全部照 SP5 `newIncidentTestServer` 范式拼装，不发明新组装方式 |
| pytest/go test 写文件污染常规 CI | 双形态：`--drill-report` / `RED_TEAM_DRILL_REPORT` 未设时零写文件（off 等价现状） |
| 矩阵某类实测非 100% 拦截（如依赖租户配置） | 如实记录 outcome（alerted/部分），验收线是"拦截或告警"≥90%，不粉饰 |
