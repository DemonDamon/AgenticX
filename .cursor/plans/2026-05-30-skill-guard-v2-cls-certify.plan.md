# Skill Guard v2 — 参考 cls-certify 加强 Skill 安全扫描

Plan-Id: 2026-05-30-skill-guard-v2-cls-certify
Status: Draft
Owner: Damon Li
Date: 2026-05-30
Research: `research/codedeepresearch/cls-certify/`（proposal / gap analysis / eval plan）
Upstream: [CatREFuse/cls-certify](https://github.com/CatREFuse/cls-certify) v2.1.0 @ `ad74b8e`（MIT）

---

## 1. What & Why

AgenticX 现有 Skill 安装拦截链路（ClawHub registry / Bundle / `skill_manage` / Desktop SettingsPanel）依赖 `agenticx/skills/guard.py`，约 63 条 regex + 结构检查 + trust matrix。对标 cls-certify（141 威胁模式 + 50+ 密钥模式 + 分级扫描 + 评分/报告 + LLM 误报复核）后，识别出三个 P0 缺口：

1. **模式库覆盖偏少**（63 vs 141）。
2. **Registry 预览只扫 SKILL.md 文本**（`scan_skill_markdown_text`），不扫内嵌代码块与 `scripts/`，存在漏检。
3. **无熵值密钥检测 / URL 外泄分类**，硬编码 secret 与外发地址识别弱。

本计划在 **不引入 bash 工具链、不改安装主流程、保持现有 `scan_skill`/`should_allow`/`scan_result_to_payload` API** 的前提下，把 cls-certify 的可验证机制（模式库 + tier 分级 + 评分 + 可选 LLM 复核）**Python 原生内化** 到 `agenticx/skills/`。

**明确不做**（遵守 no-scope-creep）：
- 不整包 fork cls-certify 作为用户内置 skill（避免双栈维护）。
- 第一阶段不做动态沙箱执行监控（cls-certify 的「维度 2」本身也只是 Agent 编排，无独立 sandbox）。
- 不做实时 NVD CVE 在线查询。
- 不做 GDPR 合规清单（Enterprise 另线）。

---

## 2. Requirements

### Functional

- FR-1: 扩展威胁/密钥模式库到 cls-certify 同等量级，按 `category` 分类，模式库与引擎分离（YAML/数据文件 + Python engine），写入 `pattern_set_version`。
- FR-2: 新增 Skill **tier 分类**（T-MD / T-LITE / T-REF / T-HEAVY），按形态决定扫描深度，避免对纯 Markdown skill 全量扫描。
- FR-3: 修复 Registry 预览漏检：对 SKILL.md 内 ```bash/python/sh/js/ts``` fenced code block **逐块扫描**；若 hub 能拉取完整文件树则对完整目录 `scan_skill`。
- FR-4: 新增 **Shannon 熵** 硬编码密钥检测（阈值 4.5，min_length 20，排除 placeholder 词表）。
- FR-5: 新增 **URL 审计**（提取 http(s) URL，标记 webhook.site / requestbin / 纯 IP / 短链等可疑外发），verdict 不高于 caution（与现有 `exfil_service` 对齐）。
- FR-6: `ScanResult` 扩展可选字段 `score`(0-100) / `grade`(S+~D) / `tier` / `pattern_set_version`，旧客户端忽略不影响。
- FR-7: 新增 `scan_skill_deep(skill_dir, *, source, mode, verify_with_llm)` 供「完整安全扫描」入口（CLI / Settings 按钮）。
- FR-8: 误报启发式（无 LLM）：命中行在反引号 / 文档列表 / 同行含 `scan|detect|check` 等场景降级或排除；`references/threat-patterns.md` 等模式库文件默认 exclude。
- FR-9: 可选 LLM 意图复核（`verify_with_llm=True`，默认关闭）：对候选 finding 走 Meta 模型按 confirmed/false_positive 判定。
- FR-10: Desktop 扫描摘要展示 grade + top findings（扩展 `formatSkillScanSummary`），新增模式 label 中文化。
- FR-11: 配置开关：`~/.agenticx/config.yaml` 的 `skills.guard.{version,scan_mode,llm_verify}`，支持灰度回退到 v1。

### Non-Functional

- NFR-1: 纯 Python，无 bash/jq/gh 运行时依赖（Windows 打包友好）。
- NFR-2: P95 扫描延迟 — T-MD ≤ 3s，T-HEAVY ≤ 15s；单文件设行数/大小上限，超时返回 caution + `scan_timeout` finding。
- NFR-3: 向后兼容 — `scan_skill` / `should_allow` / `scan_result_to_payload` 签名与现行为不变（dangerous 仍 block community/agent-created）。
- NFR-4: 确定性优先 — 默认路径不依赖 LLM，相同输入 10 次 verdict 一致。
- NFR-5: 可观测 — 结构化日志含 skill / tier / verdict / score / duration_ms / pattern_version。

### Acceptance Criteria

- AC-1: Recall@critical ≥ 95%（评测 fixture M1–M10）。
- AC-2: FPR@community ≤ 5%（benign fixture B1–B8，含 cls-certify 自身 `threat-scan.sh` 不得被 community block）。
- AC-3: Registry 预览对放在 fenced block / scripts 内的恶意模式漏检率 = 0%（fixture）。
- AC-4: `tests/test_smoke_hermes_agent_guard.py` + `tests/test_smoke_hermes_agent_skill_manage.py` 全绿，新增 `tests/test_skill_guard_cls_patterns.py` 全绿。
- AC-5: `skills.guard.version: 1` 时行为与当前完全一致（回退验证）。
- AC-6: Desktop 安装预览展示 grade 与命中规则，高危仍强制确认。

---

## 3. 架构与文件

```
agenticx/skills/
├── guard.py              # 现有入口（薄封装，保持 API；按 config 选 v1/v2）
├── guard_patterns.yaml   # NEW: hermes + cls-certify 合并去重模式库（含 version）
├── guard_engine.py       # NEW: 加载模式 / 扫描 / entropy / url / 误报启发式
├── guard_classify.py     # NEW: code-stats + tier 判定（port skill-classify.sh）
└── guard_score.py        # NEW: 0-100 评分 + letter grade + FORCE_D 规则
```

集成点（只改这些，可追溯）：
- `agenticx/studio/server.py` — `registry_install_preview` / `registry_install`（FR-3）
- `agenticx/extensions/installer.py` — `scan_bundle_source`（tier 透传）
- `agenticx/cli/agent_tools.py` — `skill_manage` create/patch（沿用 `scan_skill`/`should_allow`，无需改调用）
- `desktop/src/components/SettingsPanel.tsx` — `formatSkillScanSummary`（FR-10）
- `~/.agenticx/config.yaml` 读取 — `skills.guard`（FR-11）

---

## 4. 实施阶段（Tasks）

### Phase 0 — PoC（P0，3–5 天）

- [ ] T0.1 从 `upstream/tools/threat-scan.sh` + `secret-scan.sh` 导出 top critical 模式 → `guard_patterns.yaml`（含 `version: 2`、category、severity、pattern_id、regex、desc）。
- [ ] T0.2 新建 `guard_engine.py`：加载 YAML、复用现有 `_scan_text` 风格产出 `ScanFinding`（增 `category`/`pattern_id` 字段，可选）。
- [ ] T0.3 `guard.py` 按 `skills.guard.version` 选择 v1（内联模式）或 v2（YAML 引擎），默认 v1 灰度。
- [ ] T0.4 修复 Registry：`registry_install_preview` 对 SKILL.md fenced code block 逐块扫描（FR-3 MVP）。
- [ ] T0.5 fixture + `tests/test_skill_guard_cls_patterns.py`：M1–M10 召回、B1–B8 误报。

**验收**：恶意 fixture 召回不低于现有；误报不高于现有 smoke。

### Phase 1 — MVP（P1，1–2 周）

- [ ] T1.1 完整 port ~141 threat + 50 secret 模式，与 guard v1 去重合并到 `guard_patterns.yaml`。
- [ ] T1.2 `guard_classify.py`：code-stats（文件数/行数/exec 行/exec 体积/有无 references）+ tier 判定 + 扫描策略矩阵。
- [ ] T1.3 `scan_skill` 内部按 tier 调整 scan target（T-MD 仅 MD-only 子集），写 `tier` 字段。
- [ ] T1.4 误报启发式（FR-8）：反引号/文档列表/检测语境降级；模式库文件 exclude。
- [ ] T1.5 `guard_score.py`：扣分 + FORCE_D（prompt poison / L2+ 动态下载 / 反向 shell）→ `score`/`grade`。
- [ ] T1.6 `scan_result_to_payload` 透出 `score`/`grade`/`tier`/`pattern_set_version`。
- [ ] T1.7 Desktop `formatSkillScanSummary` 展示 grade + 新 pattern label 中文化。
- [ ] T1.8 config `skills.guard.{version,scan_mode}` 读取与默认值。

**验收**：AC-1~AC-6 全部通过，guard smoke 全绿。

### Phase 2 — 稳定化（P2，2–4 周）

- [ ] T2.1 Shannon 熵密钥检测（FR-4）+ placeholder 词表。
- [ ] T2.2 URL 审计 subset（FR-5）。
- [ ] T2.3 轻量依赖检测：解析 `requirements.txt` / `package.json` typosquat 启发式（不联网）。
- [ ] T2.4 `scan_skill_deep` + Settings「完整安全扫描」按钮入口。
- [ ] T2.5 可选 `verify_with_llm`（FR-9），settings 开关默认 off。
- [ ] T2.6 HTML 报告导出（参考 cls-certify template 思路，Near 主题），仅 deep 模式按需。

### Phase 3 — 可选（P3，按需）

- [ ] T3.1 GitHub repo 来源信誉（需 GitHub token / gh，可选）。
- [ ] T3.2 SARIF 输出供 CI。
- [ ] T3.3 与 Learning `skill_quality_gate.guard_scan` 分数联动。

---

## 5. 风险与回滚

| 风险 | 缓解 | 回滚 |
|------|------|------|
| 误报激增致安装体验恶化 | tier + 启发式 + `guard.version` 灰度 | config 设 `version: 1` 回 v1 |
| 大文件扫描性能回归 | tier skip + 单文件行数/大小 cap + 超时 | 沿用现有 max files/size 限制 |
| 模式库与 upstream 漂移无追踪 | `pattern_set_version` + `.changelog` 记录 | 降 version |
| Windows 误依赖 bash | 纯 Python，CI 不纳入 cls-certify bash | N/A |

config 示例：

```yaml
skills:
  guard:
    version: 2          # 1=legacy, 2=new engine
    scan_mode: standard # quick | standard | full
    llm_verify: false
```

---

## 6. 测试与评测

- 单测：`tests/test_skill_guard_cls_patterns.py`（新增，M/B fixture）。
- 回归：`tests/test_smoke_hermes_agent_guard.py`、`tests/test_smoke_hermes_agent_skill_manage.py`。
- 指标门禁见 `research/codedeepresearch/cls-certify/cls-certify_eval_plan.md`（Recall ≥95% / FPR ≤5% / 延迟 / registry parity / 稳定性）。
- CI：触达 `agenticx/skills/guard*` 的 PR 必跑 guard smoke + cls_patterns；cls-certify bash 不入 CI。

---

## 7. 提交策略

- 每阶段独立 commit，`/commit --spec=.cursor/plans/2026-05-30-skill-guard-v2-cls-certify.plan.md` 注入 `Plan-Id` / `Plan-File` trailer。
- 必含 `Made-with: Damon Li`。
- 仅 add 本任务直接改动文件（`agenticx/skills/guard*`、`studio/server.py`、`SettingsPanel.tsx`、tests、本 plan、research 产物）。
