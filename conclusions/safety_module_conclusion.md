# Safety Module Conclusion

## Overview

`agenticx/safety/` 是从 IronClaw (nearai/ironclaw, MIT OR Apache-2.0) 内化的纵深防御安全管线，提供工具输入/输出的端到端安全清洗。模块由八个独立组件组成，通过 `SafetyLayer` 统一编排，可按需对每个阶段独立启用或禁用。支持结构化审计事件、动态规则热更新、风险级沙箱推荐，以及基于 Unicode 归一化和信息熵的高级注入检测。

## 目录结构

```
agenticx/safety/
├── __init__.py              # 统一导出 34 个公共符号
├── leak_detector.py         # 密钥泄漏检测引擎（支持动态模式管理）
├── sanitizer.py             # Prompt 注入防御与内容清洗（含 Level 2 高级检测集成）
├── policy.py                # 规则化安全策略引擎（支持动态规则管理）
├── input_validator.py       # 工具输入参数安全校验（预执行拦截）
├── advanced_detector.py     # 高级注入检测：Unicode 归一化 + 信息熵分析
├── audit.py                 # 结构化安全审计事件日志
├── sandbox_policy.py        # 风险级沙箱后端推荐
└── layer.py                 # 统一安全管线 facade
```

## 管线架构

```
tool input (args)                          tool output (string)
    │                                          │
    ▼                                          ▼
┌─────────────────────┐   ┌──────────────────────────────────────────────┐
│   InputValidator    │   │           SafetyLayer (facade)              │
│                     │   │                                              │
│  shell injection    │   │  Stage 1: Length Truncation                 │
│  path traversal     │   │  Stage 2: LeakDetector (secret redact)     │
│  SSRF detection     │   │  Stage 3: Policy (rule-based block)        │
│  SQL injection      │   │  Stage 4: Sanitizer (injection escape)     │
│  custom policies    │   │           └─ Level 2: AdvancedDetector     │
└─────────────────────┘   └──────────────────────────────────────────────┘
    │                          │
    │ blocked → ToolError      │ all stages emit → SafetyAuditLog
    ▼                          ▼
    ToolExecutor             sanitized output → LLM context

                    SandboxPolicy
                  (standalone advisor)
                  risk → docker/subprocess/none
```

## 组件详解

### LeakDetector (`agenticx/safety/leak_detector.py`)

**功能**：扫描文本中的密钥/凭据泄漏，支持 BLOCK / REDACT / WARN 三种动作。

**关键类型**：
- `LeakPattern` (dataclass)：单条检测规则，含 `name`、`pattern`、`severity`、`action`；正则表达式懒编译（`@property regex`），`init=False` 保护内部 `_compiled` 字段
- `LeakMatch` (dataclass)：命中记录，含 `pattern_name`、`severity`、`action`、`start`、`end`、`masked_preview`
- `LeakScanResult` (dataclass)：扫描结果，含 `matches`、`redacted_content`；`has_matches` / `should_block` 属性
- `SecretLeakError`：BLOCK 动作触发时抛出，携带完整 `matches` 列表
- `LeakDetector`：核心检测引擎

**LeakDetector 实现要点**：
- 构造时预建前缀索引，可选加载 `pyahocorasick` 构造 Aho-Corasick 自动机加速候选过滤；无 `ahocorasick` 时退回全量扫描
- `_no_prefix_patterns` 在 `__init__` 时预计算（无前缀的模式每次扫描都要执行），避免 O(P×M) 的每次重算
- `scan(content)` → 通过候选集过滤 → 正则匹配 → 区间合并 → 生成 `redacted_content`
- `scan_and_clean(content)` → 始终返回 redacted 字符串，不抛异常（WARN 动作匹配不替换）
- `scan_and_block(content)` → 遇到 BLOCK 动作匹配时抛 `SecretLeakError`
- `_build_redacted()` 执行区间合并后替换，BLOCK/REDACT → `[REDACTED:name]`，WARN 保留原文

**17 条内置模式**（按 BLOCK/REDACT/WARN 分类）：
- BLOCK：`openai_api_key`、`anthropic_api_key`、`aws_access_key`、`github_token`、`github_fine_grained`、`stripe_key`、`slack_token`、`slack_webhook`、`private_key_pem`、`ssh_private_key`、`gcp_service_account`、`azure_connection_string`
- REDACT：`bearer_token`、`authorization_basic`
- WARN：`generic_api_key_param`、`password_param`、`high_entropy_hex`
- 可通过 `extra_patterns: list[LeakPattern]` 追加自定义规则

---

### Sanitizer (`agenticx/safety/sanitizer.py`)

**功能**：检测 Prompt 注入攻击，转义危险 token，为 LLM 上下文提供 XML 隔离包装。

**关键类型**：
- `InjectionSeverity` (Enum)：LOW / MEDIUM / HIGH / CRITICAL
- `InjectionWarning` (dataclass)：含 `pattern`、`severity`、`location`、`description`
- `SanitizedOutput` (dataclass)：含 `content`、`warnings`、`was_modified`
- `Sanitizer`：核心清洗器

**Sanitizer 实现要点**：
- 9 条注入检测正则（构造时编译）：CRITICAL 级（ignore/forget/disregard previous instructions）、HIGH 级（role manipulation: "you are now / act as"、system prompt injection）、MEDIUM 级（prompt extraction、code injection、encoded payload）
- 检测到 CRITICAL 注入或危险 token 时调用 `_escape_content()`，`was_modified` 反映实际内容是否改变
- `_escape_content()` 转义 11 种危险 token（`<|endoftext|>`、`[INST]`、`[/INST]`、`<<SYS>>` 等），使用 HTML 实体编码确保原始 token 字面量不出现在输出中；同时用正则将 `^system:/assistant:/user:` 行首标记转义
- `wrap_for_llm(content, source)` → 输出 `<tool_output source="...">...</tool_output>` 格式，`</tool_output>` 转义防止闭合攻击
- `wrap_external_content(content)` → 输出 `<external_content type="UNTRUSTED">` 格式，提示 LLM 将内容视为不可信数据

---

### Policy (`agenticx/safety/policy.py`)

**功能**：基于可配置规则对内容执行 BLOCK / WARN / REVIEW / SANITIZE 动作。

**关键类型**：
- `PolicyAction` (Enum)：WARN / BLOCK / REVIEW / SANITIZE
- `PolicySeverity` (Enum)：LOW / MEDIUM / HIGH / CRITICAL
- `PolicyRule` (dataclass)：含 `id`、`description`、`severity`、`pattern`、`action`；正则懒编译，`_compiled` 字段 `init=False`
- `PolicyCheckResult` (dataclass)：含 `matched_rules`；`is_blocked` 属性（任一规则为 BLOCK 则为 True）
- `Policy`：规则引擎，`check(content)` 遍历所有规则执行 `regex.search`

**6 条内置规则**：
- BLOCK：`system_file_access`（`/etc/passwd`、`.ssh/`、`.aws/credentials`）、`crypto_private_key`（PEM 头）、`shell_injection`（`; rm -rf` 等）
- WARN：`sql_pattern`（DROP TABLE、DELETE FROM、UNION SELECT）、`excessive_urls`（连续 10+ URL）
- SANITIZE：`encoded_exploit`（base64_decode、eval+base64）
- 可通过 `extra_rules: list[PolicyRule]` 追加规则；`rules=` 参数可完全替换默认规则集

---

### SafetyLayer (`agenticx/safety/layer.py`)

**功能**：统一安全管线 facade，按固定顺序编排四个阶段。

**关键类型**：
- `SafetyConfig` (dataclass)：`max_output_length=50000`、`injection_check_enabled=True`、`leak_detection_enabled=True`、`policy_check_enabled=True`
- `SafetyLayer`：核心编排器，构造参数允许注入自定义的 `leak_detector`、`sanitizer`、`policy` 实例

**执行流程**（`sanitize_tool_output(output, tool_name)`）：
1. 长度截断：超过 `max_output_length` 时截断并追加 `...[truncated]`
2. 泄漏检测：`LeakDetector.scan()` → 有命中则用 `redacted_content` 替换内容
3. 策略检查：`Policy.check()` → BLOCK 命中时将内容替换为 `[BLOCKED by policy: <rule_ids>] Tool output suppressed.`
4. 注入清洗：`Sanitizer.sanitize()` → `was_modified=True` 时取 `sanitized.content`；若 `was_modified=False` 但有 CRITICAL 级警告，调用 `_escape_injection_phrases()` 对注入短语额外转义

**辅助方法**：
- `wrap_for_llm(content, source)` → 委托 `Sanitizer.wrap_for_llm()`
- `wrap_external_content(content)` → 委托 `Sanitizer.wrap_external_content()`

---

### InputValidator (`agenticx/safety/input_validator.py`)

**功能**：在工具执行前扫描 LLM 生成的参数，拦截危险输入（shell 注入、路径穿越、SSRF、SQL 注入、命令替换）。

**关键类型**：
- `InputRiskLevel` (Enum)：LOW / MEDIUM / HIGH / CRITICAL
- `InputViolation` (dataclass)：含 `rule_id`、`description`、`risk_level`、`is_blocking`、`matched_value`、`param_path`
- `InputValidationResult` (dataclass)：含 `violations`；`is_blocked` 属性（任一违规为 blocking 则为 True）
- `ToolInputPolicy` (dataclass)：per-tool 自定义策略，含 `tool_name`、`risk_level`、`blocked_patterns`
- `InputValidator`：核心校验器

**InputValidator 实现要点**：
- 6 条内置规则：`shell_injection`（CRITICAL/blocking）、`path_traversal`（CRITICAL/blocking）、`system_file_ref`（CRITICAL/blocking）、`command_substitution`（HIGH/blocking）、`sql_injection`（MEDIUM/non-blocking）、`ssrf_private_ip`（HIGH/blocking）
- `_flatten_args()` 递归展开嵌套 dict/list，保证深层参数也被扫描
- 支持 `extra_rules` 追加自定义规则和 `tool_policies` per-tool 策略覆盖

---

### AdvancedInjectionDetector (`agenticx/safety/advanced_detector.py`)

**功能**：Level 2 注入检测，检测对抗性规避技术（零宽字符、Unicode 混淆字符、高熵编码载荷）。

**关键类型**：
- `AdvancedDetectionResult` (dataclass)：含 `risk_score`（0.0-1.0）、检测标志、计数、详情
- `AdvancedInjectionDetector`：检测与归一化引擎

**实现要点**：
- 零宽字符检测：9 种字符（`\u200b`、`\u200c`、`\ufeff` 等）
- Unicode 混淆字符：20 种西里尔字母→拉丁字母映射（如 Cyrillic `а` → Latin `a`）
- 信息熵分析：滑动窗口（默认 64 字符）Shannon 熵计算，阈值 4.5 bits/char
- `normalize()` 剥除零宽字符并替换混淆字符为拉丁等价物
- 通过 `Sanitizer(advanced_detector=...)` 可选集成为 Level 2 检测

---

### SafetyAuditLog (`agenticx/safety/audit.py`)

**功能**：结构化安全事件日志，记录管线各阶段的安全动作，支持查询和统计。

**关键类型**：
- `SafetyStage` (Enum)：TRUNCATION / LEAK_DETECTION / POLICY_CHECK / INJECTION_DEFENSE / INPUT_VALIDATION
- `SafetyEvent` (dataclass)：含 `tool_name`、`stage`、`action`、`rule_ids`、`severity`、`timestamp`、`details`
- `SafetyAuditLog`：基于 `deque(maxlen=N)` 的固定大小循环缓冲区

**SafetyAuditLog 实现要点**：
- `record(event)` 追加事件，超出 `max_events` 时自动淘汰最旧事件
- `query(tool_name=, stage=, severity=)` 多维过滤
- `stats()` 返回 `total_events`、`by_tool`、`by_stage`、`by_severity` 聚合统计
- `SafetyLayer` 自动在每个管线阶段触发时发射事件

---

### SandboxPolicy (`agenticx/safety/sandbox_policy.py`)

**功能**：根据工具风险等级推荐沙箱隔离后端（docker / subprocess / none）。

**关键类型**：
- `RiskLevel` (Enum)：LOW / MEDIUM / HIGH / CRITICAL
- `SandboxRecommendation` (dataclass)：含 `backend`、`network_enabled`、`max_timeout`、`memory_mb`
- `ToolRiskProfile` (dataclass)：per-tool 风险配置，含 `force_backend`、`network_enabled`、`max_timeout`
- `SandboxPolicy`：推荐引擎

**SandboxPolicy 实现要点**：
- CRITICAL/HIGH → `docker`（禁网络，短超时 60/120s）
- MEDIUM → `subprocess`（300s 超时）
- LOW → `None`（无隔离，600s 超时）
- 支持 `tool_profiles` per-tool 覆盖和基于工具名关键词的风险推断

---

### 动态规则管理

`Policy` 和 `LeakDetector` 均支持运行时规则增删，无需重启进程：

- `Policy.add_rule(rule)` / `Policy.remove_rule(rule_id)` — 动态添加/移除策略规则
- `LeakDetector.add_pattern(pattern)` / `LeakDetector.remove_pattern(name)` — 动态添加/移除检测模式，自动重建前缀索引
- `Policy.rules` / `LeakDetector.patterns` 属性返回副本，外部修改不影响内部状态

## 集成方式

`ToolExecutor` 通过可选的 `safety_layer` 参数集成，对工具输入和输出自动执行安全管线：

```python
from agenticx.safety import SafetyLayer, InputValidator, SafetyAuditLog
from agenticx.tools.executor import ToolExecutor

audit = SafetyAuditLog(max_events=5000)
safety = SafetyLayer(audit_log=audit)
executor = ToolExecutor(safety_layer=safety)

# Input validation: blocks dangerous args before execution
# Output sanitization: cleans string output before LLM context
result = executor.execute(my_tool, **kwargs)

# Query audit events
critical_events = audit.query(severity="CRITICAL")
print(audit.stats())
```

**沙箱推荐**（独立使用）：
```python
from agenticx.safety import SandboxPolicy, RiskLevel

policy = SandboxPolicy()
rec = policy.recommend("shell_executor")
# rec.backend == "docker", rec.network_enabled == False
```

## 导出符号（`agenticx/safety/__init__.py`）

```
# Core components
LeakDetector, LeakAction, LeakSeverity, LeakPattern, LeakMatch, LeakScanResult, SecretLeakError,
Sanitizer, SanitizedOutput, InjectionWarning, InjectionSeverity,
Policy, PolicyRule, PolicyAction, PolicySeverity, PolicyCheckResult,
SafetyLayer, SafetyConfig,

# Hardening additions (safety-layer-hardening plan)
InputValidator, InputValidationResult, InputViolation, InputRiskLevel, ToolInputPolicy,
AdvancedInjectionDetector, AdvancedDetectionResult,
SafetyAuditLog, SafetyEvent, SafetyStage,
SandboxPolicy, SandboxRecommendation, ToolRiskProfile, RiskLevel,
```

Total: 34 public symbols.

## Source Reference

Internalized from: https://github.com/nearai/ironclaw (MIT OR Apache-2.0)
Research notes: `research/codedeepresearch/ironclaw/`
Implementation plans:
- `.cursor/plans/2026-03-06-ironclaw-safety-layer.plan.md` — initial internalization
- `.cursor/plans/2026-03-06-safety-layer-hardening.plan.md` — hardening optimizations
