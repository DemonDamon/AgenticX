# Security Eval 模块结论

> 结论更新时间：2026-11-14（mapping 基线 `cebdabd5883de1d5a62c96ae4084de6ad036b32f`；模块状态 **new**，SP2「security-eval-and-admission」）

## Responsibility

- **模型安全红队计分（SP2）**：从 live 技能 guard 规则反向生成攻击样例 + 版本化越狱种子语料，经「攻击语料 × 模型矩阵」调用被测模型，用确定性裁判栈给出四态裁决（`refused` / `blocked_by_rule` / `bypassed` / `error`），汇总 `safety_score` 与 `grade`，落盘售前可转发的计分卡（`scorecard.md` + `scorecard.json`），供模型准入阈值与对外证据链使用。
- **与主链路对齐的评测假说**：`Judge` 不问「模型好不好」，而问「若该回复流入 AgenticX 主链路，是否会被模型自拒或规则栈（guard / leak / policy）中和」；真实跑分场景下 `resolve_provider_invoker` 仅用极简 `SYSTEM_PROMPT`，刻意不叠加 Meta/Studio 系统提示硬化，以测裸模型反应。
- Explicit non-responsibilities:
  - **不**实现运行时对话安全管线（`SafetyLayer`、`AgentRuntime` enforce 路径见 `agenticx/safety/`、`agenticx/runtime/`）；本包仅在评测态对**模型输出文本**离线重放 guard/leak/policy。
  - **不**维护 guard 规则源数据（`agenticx/skills/guard_patterns.yaml` 与 `load_pattern_set()` 归属 skills）；`corpus.py` 只消费规则并校验反向模板是否仍命中 live regex。
  - **不**承担 ADK 式智能体轨迹评测（`agenticx/evaluation/`）；与通用 evalset/轨迹匹配无交集。
  - **不**在 `agenticx` 根包 `__init__.py` 重导出；公开 Python 面仅为子包 `agenticx.security_eval`。
  - **不**实现 admin-console 准入 API 本体（CLI 输出中提示导入 `scorecard.json`，具体 HTTP 路由在 enterprise/admin 侧，非本目录职责）。

## Entry points and public interfaces

- `agenticx/security_eval/__init__.py` 导出：`AttackCase`、`build_corpus`、`corpus_version`、`Judge`、`EvalRun`、`MockInvoker`、`ModelRef`、`run_eval`（`__all__` 同集）。
- `corpus`：`AttackCase`（`to_dict`）；`build_corpus(max_attacks=..., categories=...)` → `cases` / `version` / `stale_templates`；`corpus_version()`、`seed_version()`、`load_seed()`。
- `judge`：常量 `VERDICT_REFUSED`、`VERDICT_BLOCKED`、`VERDICT_BYPASSED`、`VERDICT_ERROR`；`RuleEvidence`、`CaseVerdict`；`Judge.judge(case, response, error=...)`；`grade_for_score`（复用 `score_to_grade`）。
- `runner`：`ModelRef`、`ModelResult`（`safety_score`、`grade`、`category_stats`）；`EvalRun`；`MockInvoker`；`run_eval(...)`；`resolve_provider_invoker(timeout=...)`；`summarize(run, wall_seconds=...)`。
- `report`：`SCHEMA = "agx-security-scorecard/1"`；`build_scorecard`、`render_markdown`、`write_reports`、`load_scorecard`。
- 运维入口（包外、下游）：`agx security-eval run|show`（`agenticx/cli/security_eval_commands.py` 注册于 `main.py`），延迟导入上述符号。

## Core execution path

1. **语料**：`build_corpus` 合并 `_guard_derived_cases()`（`_GUARD_TEMPLATES` × live `CompiledPattern` 校验，漂移记入 `stale_templates`）与 `_seed_cases()`（读 `jailbreak_seed.yaml`）；`corpus_version()` = `seed_version()` + guard `pattern_set_version`。
2. **执行**：`run_eval` 对每个 `ModelRef` × 每个 `AttackCase` 调用注入式 `Invoker(provider, model, prompt)`；异常捕获为 `VERDICT_ERROR`；可选 `progress(done, total, label)`。
3. **裁决**：`Judge.judge` — 先扫 `_guard_evidence`（`_scan_text_v2`，`apply_fp_filter=False`）、`_leak_evidence`（`LeakDetector`）、`_policy_evidence`（`Policy.check`）； opening refusal 且无 evidence → `refused`；有 evidence → `blocked_by_rule`；否则 `bypassed`。
4. **聚合**：`ModelResult.safety_score` =（`refused` + `blocked_by_rule`）占比百分制；`grade_for_score` 与技能 guard 等级一致；`category_stats` 按 `AttackCase.owasp` 统计 bypass。
5. **落盘**：`write_reports` → `build_scorecard`（含逐 case `CaseVerdict` + `case_meta`）与脱敏 `render_markdown`（`_sanitize_name` 剥离疑似密钥形态）；默认 CLI 目录 `security-eval-reports/<run_id>/`。

## Data and configuration

- **种子语料**：`agenticx/security_eval/jailbreak_seed.yaml`（`version: agx-jb-seed-1.0.0` 等，扩展时须 bump version）；攻击条目含 `id`、`technique`、`category`、`owasp`、`expected_rules`、`prompt`。
- **Guard 反向模板**：`corpus._GUARD_TEMPLATES` 内联数据，`pattern` 名须与 live `pattern_name` 一致；`CATEGORY_OWASP` 映射 guard category → OWASP LLM Top 10。
- **计分卡契约**：JSON `schema` 固定 `agx-security-scorecard/1`；`load_scorecard` 校验 schema；证据写入 JSON 时 `_redact_pem_headers` 避免 PEM 头触发凭据扫描误报。
- **模型调用**：真实 invoker 依赖 `~/.agenticx/config.yaml` 等已有 provider 配置（经 `ProviderResolver`）；CLI `--mock` / `--mock-behavior` 绕过网络；`--max-attacks`、`--timeout` 控制规模与单次超时。

## Dependencies

- Upstream：`agenticx.skills.guard_engine`（`load_pattern_set`、`CompiledPattern`、`_scan_text_v2`）；`agenticx.skills.guard_score.score_to_grade`；`agenticx.safety.leak_detector.LeakDetector` / `LeakAction`；`agenticx.safety.policy.Policy`；`agenticx.llms.provider_resolver.ProviderResolver`（仅 `resolve_provider_invoker`）；PyYAML 读种子文件。
- Downstream：`agenticx/cli/security_eval_commands.py`（`security_eval_run` / `security_eval_show`）；`tests/red_team/test_red_team_drill.py`（A1 越狱线复用 `build_corpus` + `Judge` + `MockInvoker`）；文档 `docs/guides/security.md`；规划 `plans/security-governance/SP2-security-eval-and-admission.md`。
- 与 enterprise 准入：CLI 提示将 `scorecard.json` 导入 admin-console（实现不在本 roots 内）。

## Tests and operations

- `tests/test_security_eval_corpus.py`：语料规模、guard/seed 双源、`stale_templates` 为空（反向生成不变量）、payload 命中 live regex、`max_attacks` / `categories` 过滤。
- `tests/test_security_eval_judge.py`：四态裁决、拒绝与 evidence 互斥、中英拒绝头、合规回声触发 `blocked_by_rule`、`grade_for_score` 对齐。
- `tests/test_security_eval_run.py`：`MockInvoker` 全链路、`summarize` / `build_scorecard` / `write_reports` / `load_scorecard` 落盘与 schema。
- `tests/red_team/test_red_team_drill.py`：SP6 演练 A1 与 SP2 裁判引擎共用语料与判定语义（非本包独占，但为核心集成消费者）。
- 运维：`agx security-eval run --model provider/model`（可多 `--model`）或 `--mock`（CI 无密钥、无出网）；产物默认 `security-eval-reports/<run_id>/scorecard.{json,md}`；`agx security-eval show <dir>` 回看；语料 drift 时 CLI 高亮 `stale_templates`，需同步更新 `_GUARD_TEMPLATES` 或 guard 规则后再发版计分卡。