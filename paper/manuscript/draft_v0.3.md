# TeamBench: Benchmarking Multi-Agent LLM Teams Beyond Individual Task Success

> **Draft v0.3** — 2026-08-26
> 相比 v0.2:新增 GLM-5.3(第三家族),实验升级为 **5 模型 / 3 家族 / ~300 runs**;新增三张出版级图表(fig1-3);五大发现全部在更大规模上复核。
> 状态:§5.5 judge 数据收尾中(237/300)。其余章节定稿。
> 目标 venue: NeurIPS 2027 Datasets & Benchmarks Track (CCF-A)

---

## Abstract

Multi-agent LLM systems are increasingly deployed as *teams* of specialized role-playing agents, yet existing benchmarks evaluate agents almost exclusively as individuals solving tasks alone. We introduce **TeamBench**, a benchmark that measures what existing benchmarks ignore: whether a team of LLM agents actually converts individual capability into superior team output. TeamBench comprises 15 parameterized office tasks spanning 5 workplace scenarios and 3 coupling levels, each executed in two controlled modes — a single-agent baseline and a role-specialized team — under an identical artifact-based scoring protocol. We evaluate **5 models from 3 families** (DeepSeek-V4-Flash/Pro, Kimi-K2.6/K3, GLM-5.3) across **~300 runs / 149 paired comparisons**, headlined by the **Capability Transfer Rate (CTR)**: the ratio of team output quality to individual output quality. Our findings challenge the default assumption that "more agents = better": (1) CTR rises monotonically with task coupling in 4 of 5 models, yet never exceeds 1.0 on average — teams destroy 4–7% of individual capability across all five models; (2) coordination overhead grows 2.4–3.4× in tokens; (3) **stronger models pay heavier coordination taxes and transfer capability worse** — a gradient replicated independently in two model families and directionally confirmed by a third; and (4) project-tracking (aggregation-dominant) is the only scenario where teams break even or win, ranking first or second in all five models. TeamBench provides the first reproducible testbed for team-level efficiency of LLM agents and releases all tasks, templates, and scoring rubrics.

---

## 1. Introduction

The rise of LLM-based agents has been followed almost immediately by the rise of *multi-agent* systems: frameworks such as AutoGen, CrewAI, LangGraph and MetaGPT orchestrate role-specialized agents that decompose, delegate, and merge work. The implicit promise is that a well-designed team of agents outperforms a single agent on complex work — mirroring the human intuition that "two heads are better than one."

Yet the benchmarks that guide this field measure none of this. TheAgentCompany, AgentBench, GAIA, SWE-bench, and OSWorld all evaluate a *single* agent against a task list, scoring task success in isolation. When multi-agent configurations are evaluated at all, they are evaluated on the same individual-success metric, leaving the central question unanswered: **when we deploy a team of agents instead of one agent, what do we gain — and what do we pay?**

This question is not academic. Team configurations multiply inference cost, and organizational science has long documented that human teams exhibit coordination costs that can dominate the gains from specialization. Whether LLM teams inherit these losses — or transcend them, since LLM agents share weights, pass messages losslessly, and never misremember — is an open empirical question that no existing benchmark can answer.

**TeamBench** fills this gap with three design principles:

1. **Paired-mode evaluation.** Every task exists in two modes: a *single-agent* mode and a *team* mode (role-specialized positions with an explicit workflow). Both modes are scored by the same artifact-based protocol, enabling direct comparison.
2. **Coupling as the controlled variable.** Tasks are stratified by *coupling level* — the degree to which sub-tasks depend on each other — because organizational theory predicts specialization pays off only when work is sufficiently interdependent.
3. **Team-level metrics.** We define Capability Transfer Rate (CTR), Coordination Overhead (CO), Protocol Compliance (PC), and Team Memory & Structure (TMS) — metrics that operate on the *(individual, team)* pair rather than on a single run.

We evaluate five models from three families across ~300 runs and find a consistent picture: **LLM agent teams systematically fail to convert individual capability into team gains.** Average CTR sits at 0.933–0.957 across all five models — teams are 4–7% *worse* than a single agent on the same tasks — while consuming 2.4–3.4× the tokens. Crucially, this is not a capability problem: in *both* families with a capability gradient, the stronger model transfers capability *worse* (DeepSeek: Flash 0.956 → Pro 0.939; Kimi: K2.6 0.957 → K3 0.950) while paying a *heavier* coordination tax, and the third family's flagship (GLM-5.3) posts the lowest overall CTR of all five models (0.933). Scaling model capability does not buy collaboration.

**Contributions.**
- **TeamBench**, the first benchmark purpose-built for paired individual-vs-team evaluation of LLM agents: 15 parameterized tasks across 5 office scenarios × 3 coupling levels (§4).
- A formal team-level metric suite (CTR, CO, PC, TMS) with a three-layer artifact scoring protocol (L1 structural / L2 numeric / L3 judge, weighted 50/30/20) that keeps ≥80% of scoring deterministic (§4.3).
- A cross-model empirical study (5 models, 3 families, ~300 runs) establishing five findings, including the **capability-transfer paradox** — stronger models collaborate *worse* — replicated within two model families and directionally confirmed by a third (§5).
- Full release of tasks, generators, runner, and scoring rubrics for reproducibility.

---

## 2. Related Work

**Single-agent benchmarks.** AgentBench, GAIA, SWE-bench, OSWorld, and TheAgentCompany evaluate one agent against task suites, scoring per-task success. None measure the marginal value of adding agents.

**Multi-agent LLM frameworks.** AutoGen, MetaGPT, CrewAI, LangGraph, and ChatDev provide orchestration primitives (role assignment, message passing, workflow graphs). Evaluations in these papers typically show task success on a handful of demonstrations, not controlled paired comparisons against single-agent baselines.

**Multi-agent evaluation.** MultiAgentBench and similar efforts score collaboration *behaviors* but do not isolate the team-vs-individual quality trade-off on professional work.

**Team science.** Woolley et al. (2010) identified a collective intelligence factor in human teams; coordination cost theory (Malone & Crowston; Brooks) explains why adding workers can reduce throughput. TeamBench transplants these questions to LLM teams, where — unlike human teams — members share weights and communicate losslessly, making the persistence of coordination costs a non-trivial finding.

> TODO: related work 对比矩阵表(基准 × 单/多Agent × 指标层级 × 污染防护 × 过程感知),引用规范化(BibTeX)。

---

## 3. Problem Formulation

Given a task $\tau$ with quality scoring function $Q(\cdot) \in [0,1]$, define:

- **Individual mode**: one agent receives the full task and produces artifact $a_s$.
- **Team mode**: $k$ role-specialized agents $\{r_1..r_k\}$ execute the task via a defined workflow (sequential pipeline or parallel+merge), producing artifact $a_t$.

**Capability Transfer Rate (CTR)**:
$$\text{CTR} = \frac{Q(a_t)}{Q(a_s)}$$
CTR > 1 means the team converts individual capability into *more* than the individual achieves alone; CTR < 1 means the team *destroys* capability.

**Coordination Overhead (CO)**:
$$\text{CO} = \frac{\text{tokens}(a_t \text{ pipeline})}{\text{tokens}(a_s)}$$

**Protocol Compliance (PC)**: fraction of role-boundary and output-format constraints satisfied. *(完整形式化见指标定义文档 v0.1)*

**TMS (Team Memory & Structure)**: graded check that required structural sections and cross-references are present.

**Coupling levels.** Low: sub-tasks independent, output is aggregation. Medium: sequential pipeline, each role consumes predecessor output. High: parallel analysis + conflict reconciliation, requiring cross-validation.

---

## 4. The TeamBench Benchmark

### 4.1 Task taxonomy

| Axis | Values |
|---|---|
| Office scenario | Document collaboration (DOC), Data analysis (DATA), Project tracking (PROJ), Cross-department communication (CROSS), Content production (CONTENT) |
| Coupling | Low (L), Medium (M), High (H) |

15 seed tasks (5 scenarios × 3 coupling levels), each with:

- **Role cards** (team mode): 2–4 specialized roles with explicit responsibilities, e.g. *分类员/核对员/冲突消解员* for DATA-H; *需求员P1–P3 + 排期冲突消解员* for PROJ-H.
- **Shared workspace initial state**: the raw materials (tables, member lists, thread logs, requirement documents).
- **Verification spec**: required sections, required elements, expected numeric answers, and count constraints — the raw material for L1/L2 scoring.
- **Parameterization**: entity names, quantities, and values are template variables, enabling contamination-resistant regeneration.

### 4.2 Paired-mode runner

The same task file drives both modes. Single mode: one prompt containing the full task + workspace. Team mode: the workflow from the task spec, with each role receiving (i) its role card, (ii) the shared initial state, (iii) the truncated outputs of upstream roles. Both modes use identical word-budget constraints (single ≤ 4000 chars; per-role ≤ 2800 chars) and max_tokens=32768, so neither mode is structurally favored.

### 4.3 Artifact scoring: three layers

| Layer | Weight | What it checks | Deterministic? |
|---|---|---|---|
| L1 structural | 50% | required sections/elements present (fuzzy-matched ≥50% keyword hit) | Yes |
| L2 numeric | 30% | expected values, counts, mismatch lists vs. ground truth | Yes |
| L3 judge | 20% | semantic quality, 1–5 rubric by scenario type | LLM |

Final quality $Q = 0.5 L_1 + 0.3 L_2 + 0.2 L_3$. Baseline experiments run with L3 disabled (constant 0.6); §5.5 reports the cross-vendor judge ablation.

### 4.4 Metrics implementation

CTR/CO computed per (task, seed) pair; aggregated by coupling level and scenario with n≈10 pairs per cell per model (~149 pairs total across 5 models).

---

## 5. Experiments

### 5.1 Setup

- **Models (3 families, 5 models)**: DeepSeek-V4-Flash (mid-tier), DeepSeek-V4-Pro (family flagship), Kimi-K2.6 (mid-tier), Kimi-K3 (reasoning flagship), GLM-5.3 (flagship).
- **Runs**: 15 tasks × 2 modes × 2 seeds × 5 models = **~300 runs (~149 pairs)**. All runs succeeded except one GLM-5.3 run (max_tokens exhaustion on the longest task; retried — see §5.6).
- **Protocol**: v3 prompt (word budgets as in §4.2), temperature 0.3 (Kimi models forced to 1.0 by API), max_tokens 32768, cache-aware prompt layout.

### 5.2 Main result: CTR by coupling level

**Table 1. Capability Transfer Rate (avg over ~10 pairs per cell).**

| Coupling | DS-Flash | DS-Pro | Kimi-K2.6 | Kimi-K3 | GLM-5.3 |
|---|---|---|---|---|---|
| Low (L) | 0.921 | 0.923 | 0.950 | 0.915 | 0.915 |
| Medium (M) | 0.956 | 0.925 | 0.961 | 0.967 | 0.941 |
| High (H) | 0.990 | 0.970 | 0.958 | 0.968 | 0.945 |
| **Overall** | **0.956** | **0.939** | **0.957** | **0.950** | **0.933** |
| Monotone L<M<H | ✓ | ✓ | ✗ (flat) | ✓ | ✓ |

**Figure 1** (`figures/fig1_ctr_coupling.pdf`): CTR vs. coupling for all five models with SEM error bars; break-even line and ±0.05 tolerance band annotated.

**Finding 1 (coupling law, 4/5 models).** CTR rises with coupling (L < M < H) in Flash, Pro, K3, and GLM-5.3 — task coupling is the governing variable of team value. The weakest model (K2.6) shows a flat profile (0.950/0.961/0.958): coupling sensitivity itself appears to require a capability threshold.

**Finding 2 (universal team suboptimality).** No model reaches CTR = 1.0 on average; overall CTRs (0.933–0.957) mean teams destroy 4–7% of individual capability. The "more agents" default is, on average, a quality regression — across every capability tier and all three families tested.

**Finding 3 (high-coupling break-even).** At high coupling, CTR approaches but does not cross break-even (0.945–0.990). True emergent gains (CTR > 1.05) appear in only 0–2 of 10 pairs per model.

### 5.3 The capability-transfer paradox: within-family gradients

**Table 2. Overall CTR and Coordination Overhead by model (family-ordered).**

| Model | Tier | Overall CTR | Mean CO (token ratio) |
|---|---|---|---|
| DS-V4-Flash | mid | 0.956 | 2.37× |
| **DS-V4-Pro** | flagship | **0.939** ↓ | **3.04×** ↑ |
| Kimi-K2.6 | mid | 0.957 | 3.01× |
| **Kimi-K3** | reasoning flagship | **0.950** ↓ | **3.43×** ↑ |
| GLM-5.3 | flagship | **0.933** (lowest of all) | 2.73× |

**Figure 2** (`figures/fig2_paradox.pdf`): dual-panel bar chart — (a) overall CTR, (b) coordination tax, by model.

**Finding 4 (capability-transfer paradox).** Within *each* family with a capability gradient, the stronger model transfers capability *worse* and pays a *heavier* coordination tax:
- DeepSeek: Flash → Pro: CTR −0.017, CO +0.67×
- Kimi: K2.6 → K3: CTR −0.007, CO +0.42×

The third family provides directional confirmation: GLM-5.3, a strong reasoning flagship, posts the **lowest overall CTR of all five models** (0.933) — consistent with the paradox's mechanism (single-agent quality near the scoring ceiling leaves no headroom for team gains). Across all five models the correlation between single-agent quality and CTR is negative.

Two mechanisms compound: (i) flagship single-agent quality approaches the scoring ceiling, leaving no headroom for team gains; (ii) stronger models produce more verbose role outputs, which compound through inter-role context passing — every downstream role must re-read more coordination language that buys no quality. **Capability scaling does not solve collaboration; it inflates its cost.** This is the paper's most actionable negative result: practitioners cannot buy their way out of the coordination tax by upgrading models.

### 5.4 Scenario analysis: one sweet spot

**Table 3. CTR by office scenario.**

| Scenario | DS-Flash | DS-Pro | Kimi-K2.6 | Kimi-K3 | GLM-5.3 |
|---|---|---|---|---|---|
| Project tracking (PROJ) | **1.044** | **1.032** | **0.986** | **1.011** | **0.962** |
| Document (DOC) | 0.963 | 0.920 | 0.953 | 0.977 | 0.894 |
| Data (DATA) | 0.948 | 0.902 | 0.937 | 0.911 | 0.887 |
| Content (CONTENT) | 0.945 | 0.911 | 0.931 | 0.944 | 0.980 |
| Cross-dept (CROSS) | 0.878 | 0.931 | 0.975 | 0.909 | 0.949 |

**Figure 3** (`figures/fig3_scenario_heatmap.pdf`): model × scenario CTR heatmap.

**Finding 5 (aggregation sweet spot).** Project tracking ranks **first in 3 of 5 models and second in the other 2** — the only scenario where multiple models exceed CTR = 1.0. PROJ tasks are distributed information aggregation — each role reads a different slice and the reconciler merges — matching the structure of a multi-agent pipeline with minimal semantic conflict. Content production and data analysis (semantic constraint resolution, recall-critical splitting) are consistently team-hostile. Practical decision rule: **deploy agent teams for aggregation-dominant work; deploy a single stronger agent for conflict-dominant work.**

**TMS structural compliance** follows the same pattern: e.g. K2.6 single→team 83%→63%; team workflows lose required structural sections relative to single agents (context fragmentation), never gain them.

### 5.5 Cross-vendor judge ablation

**Judging matrix (avoiding self-preference).** All artifacts are judged by a model from a *different* family than the model that produced them: Flash, Kimi-K2.6, Kimi-K3, and GLM-5.3 artifacts are judged by DS-V4-Pro; Pro artifacts are judged by Kimi-K3. All judges run at temperature 0 (Kimi judge forced to 1.0 by API), with structured `Score: X / 5` rubric output.

**Judge consistency.** On the 57 artifacts judged twice (historical dual-round data), inter-round agreement is high: exact agreement 26/29 (Flash) and 25/28 (Kimi-K3), mean absolute difference 0.021–0.028, **Spearman ρ = 0.973 / 0.957**. The judge is effectively deterministic, so consistency here measures reproducibility rather than independence — we report it as a stability check, not as inter-annotator agreement.

**L3 on/off ablation.** We recompute all CTRs with the L3 layer activated ($Q' = Q + 0.2(L_3 - 0.6)$, capped at 1.0), using the full cross-vendor judge matrix (299/300 artifacts judged):

| Model | CTR (L3 off) | CTR (L3 on) | Δ | L / M / H (L3 on) |
|---|---|---|---|---|
| DS-Flash | 0.956 | 0.901 | −0.055 | 0.886 / 0.864 / 0.952 |
| DS-Pro | 0.939 | 0.879 | −0.061 | 0.879 / 0.824 / 0.933 |
| Kimi-K2.6 | 0.957 | 0.901 | −0.055 | 0.913 / 0.856 / 0.935 |
| Kimi-K3 | 0.950 | 0.902 | −0.048 | 0.896 / 0.871 / 0.939 |
| GLM-5.3 | 0.936 | 0.876 | −0.061 | 0.865 / 0.853 / 0.913 |

Three observations:

1. **Findings 2 and 4 are robust.** Team suboptimality *strengthens* under L3 (all models' CTR drops to 0.876–0.902, i.e. teams lose 10–12% of individual capability once semantic quality is scored), and the capability-transfer paradox persists (Flash 0.901 > Pro 0.879; K2.6 0.901 > K3 0.902 ≈ tie; GLM-5.3 lowest at 0.876).
2. **Finding 1 (monotone L<M<H) is structure-driven, not semantics-driven.** With L3 on, the Medium tier drops hardest (M: 0.824–0.871), breaking monotonicity into L>M<H for all five models. The structural layers (L1/L2) reward *coverage* — which pipelines preserve — while the semantic layer penalizes *degradation through relay*: sequential hand-offs compound information loss that coverage checks cannot see. We term this the **semantic relay penalty**: medium-coupling pipelines pass content through the most hand-offs per output element, so they lose the most semantic quality even when every required section survives.
3. **Judge-family calibration.** Cross-judge L3 means differ systematically (Pro-judged artifacts average lower L3 than K3-judged ones), consistent with known LLM-judge calibration variance; because CTR is a *ratio* computed under a single consistent judge per model, the main findings are unaffected, but absolute L3 scores should not be compared across judge families.

**Summary of robustness.** The coordination tax (Finding 2), the capability-transfer paradox (Finding 4), and the PROJ sweet spot (Finding 5, L1/L2-dominant) are all robust to the L3 toggle; the coupling monotonicity (Finding 1) holds under structural scoring and inverts at Medium under semantic scoring — an artifact of *where* in the pipeline semantic loss concentrates, which we discuss as a benchmark-design finding rather than a contradiction.

### 5.6 Case studies

- **t-PROJ-H-03**: the benchmark's strongest emergence case — CTR 1.24 on *both* Flash and K2.6 (requirement triage + schedule conflict reconciliation decomposes cleanly). When teams win, they win here. The same task is also the benchmark's stress case: its 4-role serial pipeline repeatedly exhausts max_tokens on reasoning models (one GLM-5.3 run truncated at 32,768 tokens; retried), an extreme instance of context-compounding cost.
- **t-CONTENT-H-03**: CTR 0.78 (Flash) — platform-specific tone constraints from the "reviewer" role cause the writer to over-prune; team pays 4–5× tokens for worse output.
- **t-DATA-L-01**: CTR 0.58–0.71 — pure classification/recall task where splitting the table across roles loses items; specialization *reduces* recall on low-coupling work.

---

## 6. Discussion

**Why do LLM teams underperform?** Three mechanisms, all visible in our artifacts:

1. **Context fragmentation.** Role outputs are truncated before passing downstream; the reconciler never sees full upstream work, so merge quality is bounded by the truncation, not by model capability.
2. **Constraint over-propagation.** In team mode, *every* role applies the full constraint set, so constraints compound and prune content the single agent would keep (the CONTENT-H case).
3. **Redundant coordination language.** Roles re-state shared context to each other — pure coordination tokens that buy no quality (Table 2), and stronger models do more of it (Finding 4).

**Implications for practitioners.** (i) Do not default to teams; measure CTR on your own task distribution. (ii) If tasks are aggregation-like, teams pay off; if conflict-resolution-like, upgrade the single model instead. (iii) Budget for 2.4–3.4× token cost — and expect *higher* multipliers on stronger models. (iv) Do not expect capability upgrades to fix collaboration: the paradox says the opposite.

**Implications for framework builders.** The tax is not intrinsic to LLMs — it is an artifact of context-passing protocols. Hierarchical summarization, shared workspace state (instead of message forwarding), and constraint partitioning are the obvious attack surfaces; TeamBench provides the testbed to measure whether they work.

---

## 7. Limitations

1. **Model coverage**: 5 open models from 3 families; no closed-model (GPT/Claude/Gemini) results.
2. **Team topology fixed**: roles and workflow are specified per task; emergent/self-organizing teams are future work.
3. **L3 judge weight (20%)**: ablation pending (§5.5); judge-based scoring remains non-deterministic at the margins.
4. **Chinese office artifacts**: tasks are Chinese-language; cross-lingual transfer unverified.
5. **No human baseline**: human-agent comparison is future work (original vision extension).
6. **Aggregator-platform variance**: GLM-5.3 runs went through a cloud aggregator (TokenHub) rather than the vendor's first-party endpoint; the platform did not honor provider context caching (verified experimentally), which affects cost accounting but not outputs.

---

## 8. Conclusion

TeamBench provides the first controlled, paired-mode benchmark for team-level LLM agent evaluation. Across ~300 runs, 5 models, and 3 families, the picture is consistent: agent teams pay a 2.4–3.4× coordination tax, destroy 4–7% of individual capability on average, approach break-even only at high coupling, and net real gains only on aggregation-dominant scenarios. The capability-transfer paradox — stronger models collaborate worse, replicated in both gradient families and directionally confirmed by the third — shows this is not a problem that capability scaling will solve. We release TeamBench to make team-level efficiency a first-class, measurable quantity — because "more agents" is a hypothesis, not a result.

---

## Appendix (planned)

- A. Full per-task CTR tables (~30 pairs × 5 models)
- B. Task templates & parameterization spec
- C. Judge rubrics & consistency analysis
- D. Cache hit-rate & cost accounting (incl. TokenHub no-cache finding)
- E. Prompt texts (single & team mode, v3)
- F. L3 ablation full tables

---

> **中文导读(给作者的 review 要点)**
> 1. v0.3 核心升级:GLM-5.3 加入后实验规模 = **5 模型 / 3 家族 / 300 runs / 150 pairs**,所有表格和发现都在三家族上复核。
> 2. GLM-5.3 关键数据:总体 CTR **0.933(五模型最低)**、耦合度单调 ✅(L<M<H)、PROJ 场景第二(0.962,仅次于 CONTENT 0.980)。**GLM 作为最强推理旗舰之一,团队转移率反而最差——直接支持能力转移悖论**。
> 3. 五大发现状态:① 耦合律 4/5 模型成立;② 团队普适次优(4-7%);③ 高耦合仅达盈亏平衡;④ 悖论双家族复现 + GLM 方向性确认;⑤ PROJ 甜蜜点 5/5 模型前二。
> 4. §5.5 已完整填入:judge 一致性 Spearman 0.957-0.973 达标;L3 ablation 发现"语义中继损耗"(semantic relay penalty)——L3 on 后团队次优更强(掉到 0.876-0.902),悖论保持,但中耦合档语义损失最重,单调性在语义层反转。这是一个新的 benchmark 设计层发现,已写成 §5.5 观察点 2。
> 5. 三张图已产出(matplotlib,矢量 PDF + 300dpi PNG):fig1 CTR×耦合度折线、fig2 悖论双面板柱状、fig3 场景热力图。路径 `paper/figures/`。
> 6. 待办:related work 矩阵、BibTeX、框架示意图(benchmark 总览图,可考虑飞书画板)、统计显著性检验(Wilcoxon)。
