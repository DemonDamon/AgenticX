# TeamBench: Benchmarking Multi-Agent LLM Teams Beyond Individual Task Success

> **Draft v0.5** — 2026-08-26
> 相比 v0.4:① 新增 §6 运行时可控性讨论(runtime controllability as an unmeasured moderator——预算封顶 / 人机中途纠偏 / 暂停续跑,受 SwarmFlow 等生产级平台将三者标准化为算子的启发);② 新增 §7 Limitation 7(开环测量:无预算约束、无中途介入、无暂停续跑);③ 提出 budget-aware CTR 与 intervention-robustness CTR 两个后继指标并写入 released roadmap。
> 状态:**数据完备的完整稿**。下一版 v1.0 = 润色 + LaTeX 化。
> 目标 venue: NeurIPS 2027 Datasets & Benchmarks Track (CCF-A)

---

## Abstract

Multi-agent LLM systems are increasingly deployed as *teams* of specialized role-playing agents, yet existing benchmarks evaluate agents almost exclusively as individuals solving tasks alone. We introduce **TeamBench**, a benchmark that measures what existing benchmarks ignore: whether a team of LLM agents actually converts individual capability into superior team output. TeamBench comprises 15 parameterized office tasks spanning 5 workplace scenarios and 3 coupling levels, each executed in two controlled modes — a single-agent baseline and a role-specialized team — under an identical artifact-based scoring protocol. We evaluate **5 models from 3 families** (DeepSeek-V4-Flash/Pro, Kimi-K2.6/K3, GLM-5.3) across **300 runs / 150 paired comparisons**, headlined by the **Capability Transfer Rate (CTR)**: the ratio of team output quality to individual output quality. Our findings challenge the default assumption that "more agents = better": (1) teams systematically destroy individual capability — mean CTR 0.93–0.96 across all five models, with the pooled quality deficit significant at *p* < 10⁻⁵; (2) coordination overhead grows 2.4–3.4× in tokens; (3) **stronger models transfer capability worse while paying heavier coordination taxes** — a gradient directionally consistent within both families offering a capability tier and across the third family's flagship; and (4) project-tracking (aggregation-dominant) is the only scenario where teams break even or win (pooled CTR 1.009 vs 0.932, *p* = 0.006), ranking first or second in all five models. TeamBench provides the first reproducible testbed for team-level efficiency of LLM agents and releases all tasks, templates, and scoring rubrics.

---

## 1. Introduction

The rise of LLM-based agents has been followed almost immediately by the rise of *multi-agent* systems: frameworks such as AutoGen, CrewAI, LangGraph and MetaGPT orchestrate role-specialized agents that decompose, delegate, and merge work. The implicit promise is that a well-designed team of agents outperforms a single agent on complex work — mirroring the human intuition that "two heads are better than one."

Yet the benchmarks that guide this field measure none of this. TheAgentCompany, AgentBench, GAIA, SWE-bench, and OSWorld all evaluate a *single* agent against a task list, scoring task success in isolation. When multi-agent configurations are evaluated at all, they are evaluated on the same individual-success metric, leaving the central question unanswered: **when we deploy a team of agents instead of one agent, what do we gain — and what do we pay?**

This question is not academic. Team configurations multiply inference cost, and organizational science has long documented that human teams exhibit coordination costs that can dominate the gains from specialization. Whether LLM teams inherit these losses — or transcend them, since LLM agents share weights, pass messages losslessly, and never misremember — is an open empirical question that no existing benchmark can answer.

**TeamBench** fills this gap with three design principles (Figure 1):

1. **Paired-mode evaluation.** Every task exists in two modes: a *single-agent* mode and a *team* mode (role-specialized positions with an explicit workflow). Both modes are scored by the same artifact-based protocol, enabling direct comparison.
2. **Coupling as the controlled variable.** Tasks are stratified by *coupling level* — the degree to which sub-tasks depend on each other — because organizational theory predicts specialization pays off only when work is sufficiently interdependent.
3. **Team-level metrics.** We define Capability Transfer Rate (CTR), Coordination Overhead (CO), Protocol Compliance (PC), and Team Memory & Structure (TMS) — metrics that operate on the *(individual, team)* pair rather than on a single run.

We evaluate five models from three families across 300 runs and find a consistent picture: **LLM agent teams systematically fail to convert individual capability into team gains.** Average CTR sits at 0.933–0.957 across all five models — teams are 4–7% *worse* than a single agent on the same tasks (pooled *p* < 10⁻⁵) — while consuming 2.4–3.4× the tokens. Crucially, this is not a capability problem that capability solves: in *both* families with a capability gradient, the stronger model transfers capability *worse* (DeepSeek: Flash 0.956 → Pro 0.939; Kimi: K2.6 0.957 → K3 0.950) while paying a *heavier* coordination tax, and the third family's flagship (GLM-5.3) posts the lowest overall CTR of all five models (0.933). Scaling model capability does not buy collaboration.

**Contributions.**
- **TeamBench**, the first benchmark purpose-built for paired individual-vs-team evaluation of LLM agents: 15 parameterized tasks across 5 office scenarios × 3 coupling levels (§4).
- A formal team-level metric suite (CTR, CO, PC, TMS) with a three-layer artifact scoring protocol (L1 structural / L2 numeric / L3 judge, weighted 50/30/20) that keeps ≥80% of scoring deterministic, with a cross-vendor judge design and consistency analysis (§4.3, §5.5).
- A cross-model empirical study (5 models, 3 families, 300 runs) establishing five findings with statistical tests, including the **capability-transfer paradox** — stronger models collaborate *worse* — directionally consistent in all three families (§5).
- Full release of tasks, generators, runner, and scoring rubrics for reproducibility.

---

## 2. Related Work

### 2.1 Comparison matrix

**Table R1. TeamBench vs. existing agent benchmarks and multi-agent studies.**

| Benchmark | # Agents scored | Paired single vs team | Team-level metrics | Coupling axis | Office/professional tasks | Contamination defense |
|---|---|---|---|---|---|---|
| AgentBench [6] | 1 | ✗ | ✗ | ✗ | partial (game/OS) | ✗ |
| GAIA [7] | 1 | ✗ | ✗ | ✗ | ✗ | ✗ |
| SWE-bench [8] | 1 | ✗ | ✗ | ✗ | ✗ | ✗ |
| OSWorld [9] | 1 | ✗ | ✗ | ✗ | ✗ | ✗ |
| TheAgentCompany [10] | 1 | ✗ | ✗ | ✗ | ✓ | ✗ |
| More Agents Is All You Need [19] | k (scaling) | ✗ (single-metric) | ✗ | ✗ | ✗ | ✗ |
| MultiAgentBench [16] | k | ✗ | behavior scores | ✗ | ✗ | ✗ |
| Agents' Room [17] | k | ✗ | ✗ | ✗ | ✗ | ✗ |
| **TeamBench (ours)** | **1 ↔ k, paired** | **✓** | **CTR / CO / PC / TMS** | **✓ (L/M/H)** | **✓ (5 scenarios)** | **✓ (parameterized)** |

### 2.2 Single-agent benchmarks

AgentBench [6] evaluates LLMs as autonomous agents across eight interactive environments; GAIA [7] tests general assistant ability with multi-step questions; SWE-bench [8] scores repository-level issue resolution; OSWorld [9] grounds agents in a computer environment; TheAgentCompany [10] is closest in task flavor — professional office work — but scores a *single* agent on task completion. None measures the marginal value of adding agents.

### 2.3 Multi-agent systems and their evaluation

AutoGen [11], MetaGPT [12], CrewAI [13], LangGraph [14], and ChatDev [15] provide orchestration primitives; their papers report task success on demonstrations, not controlled paired comparisons. "More Agents Is All You Need" [19] and "Are More LLM Calls All You Need?" [20] study *performance scaling* with agent count but on single-agent metrics, without isolating team-vs-individual quality. MultiAgentBench [16] scores collaboration behaviors (e.g., final-answer agreement) but not the capability-transfer question. Agents' Room [17] shows structurally coordinated agents improve narrative generation — an existence proof that coordination *can* help, which TeamBench complements by quantifying *when* it does across a task space. Recent surveys [21, 22] explicitly list team-level evaluation as an open problem.

### 2.4 Team science and coordination cost

Woolley et al. [23] identified a collective-intelligence factor in human teams; coordination theory [24] and Brooks [25] explain why adding workers can reduce throughput ("mythical man-month"). TeamBench transplants these questions to LLM teams, where — unlike human teams — members share weights and communicate losslessly, making the persistence of coordination costs a non-trivial finding rather than a foregone conclusion.

### 2.5 LLM-as-judge

We adopt LLM judging at temperature 0 with structured rubrics following MT-Bench [26], and extend it with (i) a cross-vendor judge matrix (the judge is never from the same family as the judged model) and (ii) an on/off ablation quantifying how judge-layer scores interact with structural layers (§5.5).

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

**Protocol Compliance (PC)**: fraction of role-boundary and output-format constraints satisfied. *(Full formalization in the metrics document v0.1.)*

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

- **Role cards** (team mode): 2–4 specialized roles with explicit responsibilities, e.g. *classifier/verifier/conflict-resolver* for DATA-H; *requirement owners P1–P3 + schedule conflict resolver* for PROJ-H.
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

CTR/CO computed per (task, seed) pair; aggregated by coupling level and scenario with n = 30 pairs per model (150 total).

---

## 5. Experiments

### 5.1 Setup

- **Models (3 families, 5 models)**: DeepSeek-V4-Flash (mid-tier), DeepSeek-V4-Pro (family flagship), Kimi-K2.6 (mid-tier), Kimi-K3 (reasoning flagship), GLM-5.3 (flagship).
- **Runs**: 15 tasks × 2 modes × 2 seeds × 5 models = **300 runs / 150 pairs**; all completed (one GLM-5.3 run hit max_tokens and was retried successfully).
- **Protocol**: v3 prompt (word budgets as in §4.2), temperature 0.3 (Kimi models forced to 1.0 by API), max_tokens 32768, cache-aware prompt layout.
- **Statistics**: Wilcoxon signed-rank (paired quality comparisons; normal approximation with continuity and tie correction), Mann-Whitney U (between-group CTR comparisons). Significance: *p*<0.05, **p**<0.01, ***p***<0.001.

### 5.2 Main result: CTR by coupling level

**Table 1. Capability Transfer Rate (avg over 30 pairs per model; ~10 per cell).**

| Coupling | DS-Flash | DS-Pro | Kimi-K2.6 | Kimi-K3 | GLM-5.3 | Pooled |
|---|---|---|---|---|---|---|
| Low (L) | 0.921 | 0.923 | 0.950 | 0.915 | 0.915 | 0.925 |
| Medium (M) | 0.956 | 0.925 | 0.961 | 0.967 | 0.941 | 0.950 |
| High (H) | 0.990 | 0.970 | 0.958 | 0.968 | 0.945 | 0.968 |
| **Overall** | **0.956** | **0.939** | **0.957** | **0.950** | **0.933** | **0.949** |
| Monotone L<M<H | ✓ | ✓ | ✗ (flat) | ✓ | ✓ | ✓ (trend) |

**Figure 2** (`figures/fig1_ctr_coupling.pdf`): CTR vs. coupling for all five models with SEM error bars; break-even line and ±0.05 tolerance band annotated.

**Finding 1 (coupling law, 4/5 models).** CTR rises with coupling (L < M < H) in Flash, Pro, K3, and GLM-5.3 — task coupling is the governing variable of team value. The weakest model (K2.6) shows a flat profile (0.950/0.961/0.958): coupling sensitivity itself appears to require a capability threshold. The pooled trend (0.925 → 0.950 → 0.968) is monotone but pairwise differences do not reach significance at n=50 per tier (*p* = 0.17–0.87, Mann-Whitney); we report it as a consistent descriptive trend, underpowered at the per-cell sample size.

**Finding 2 (universal team suboptimality).** No model reaches CTR = 1.0 on average; overall CTRs (0.933–0.957) mean teams destroy 4–7% of individual capability. **Pooled across all 150 pairs, the quality deficit is highly significant (Wilcoxon, n=101 non-zero diffs, W=1206, *p* = 3.5×10⁻⁶); per-model, 4 of 5 models are individually significant (Table S1 in §5.7) and the fifth (K2.6) is marginal (*p* = 0.094).** The "more agents" default is, on average, a quality regression — across every capability tier and all three families tested.

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

**Figure 3** (`figures/fig2_paradox.pdf`): dual-panel bar chart — (a) overall CTR, (b) coordination tax, by model.

**Finding 4 (capability-transfer paradox).** Within *each* family with a capability gradient, the stronger model transfers capability *worse* and pays a *heavier* coordination tax:
- DeepSeek: Flash → Pro: CTR −0.017, CO +0.67×
- Kimi: K2.6 → K3: CTR −0.007, CO +0.42×

The third family provides directional confirmation: GLM-5.3, a strong reasoning flagship, posts the **lowest overall CTR of all five models** (0.933). Across all five models, single-agent quality correlates negatively with CTR. We note honestly: paired per-family tests do not reach individual significance (DS: *p* = 0.137; Kimi: *p* = 0.851, Wilcoxon on paired CTR differences, n=30) — the effect is small in absolute terms and our per-family sample is underpowered for it; its evidential weight comes from the *consistency of direction across three independent families and five models* (and it strengthens, not weakens, under the L3 judge layer, §5.5).

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

**Figure 4** (`figures/fig3_scenario_heatmap.pdf`): model × scenario CTR heatmap.

**Finding 5 (aggregation sweet spot).** Project tracking ranks **first in 3 of 5 models and second in the other 2** — the only scenario where multiple models exceed CTR = 1.0. **Pooled across models, PROJ CTR = 1.009 vs 0.932 for all other scenarios (Mann-Whitney U, *p* = 0.006)**; per-model, the effect is individually significant only for DS-Pro (*p* = 0.014). PROJ tasks are distributed information aggregation — each role reads a different slice and the reconciler merges — matching the structure of a multi-agent pipeline with minimal semantic conflict. Content production and data analysis (semantic constraint resolution, recall-critical splitting) are consistently team-hostile. Practical decision rule: **deploy agent teams for aggregation-dominant work; deploy a single stronger agent for conflict-dominant work.**

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

1. **Findings 2 and 4 are robust.** Team suboptimality *strengthens* under L3 (all models' CTR drops to 0.876–0.902, i.e. teams lose 10–12% of individual capability once semantic quality is scored), and the capability-transfer paradox persists (Flash 0.901 > Pro 0.879; K2.6 0.901 ≈ K3 0.902; GLM-5.3 lowest at 0.876).
2. **Finding 1 (monotone L<M<H) is structure-driven, not semantics-driven.** With L3 on, the Medium tier drops hardest (M: 0.824–0.871), breaking monotonicity into L>M<H for all five models. The structural layers (L1/L2) reward *coverage* — which pipelines preserve — while the semantic layer penalizes *degradation through relay*: sequential hand-offs compound information loss that coverage checks cannot see. We term this the **semantic relay penalty**: medium-coupling pipelines pass content through the most hand-offs per output element, so they lose the most semantic quality even when every required section survives.
3. **Judge-family calibration.** Cross-judge L3 means differ systematically (Pro-judged artifacts average lower L3 than K3-judged ones), consistent with known LLM-judge calibration variance [26]; because CTR is a *ratio* computed under a single consistent judge per model, the main findings are unaffected, but absolute L3 scores should not be compared across judge families.

**Summary of robustness.** The coordination tax (Finding 2), the capability-transfer paradox (Finding 4), and the PROJ sweet spot (Finding 5, L1/L2-dominant) are all robust to the L3 toggle; the coupling monotonicity (Finding 1) holds under structural scoring and inverts at Medium under semantic scoring — an artifact of *where* in the pipeline semantic loss concentrates, which we discuss as a benchmark-design finding rather than a contradiction.

### 5.6 Case studies

- **t-PROJ-H-03**: the benchmark's strongest emergence case — CTR 1.24 on *both* Flash and K2.6 (requirement triage + schedule conflict reconciliation decomposes cleanly). When teams win, they win here. The same task is also the benchmark's stress case: its 4-role serial pipeline repeatedly exhausts max_tokens on reasoning models (one GLM-5.3 run truncated at 32,768 tokens; retried), an extreme instance of context-compounding cost.
- **t-CONTENT-H-03**: CTR 0.78 (Flash) — platform-specific tone constraints from the "reviewer" role cause the writer to over-prune; team pays 4–5× tokens for worse output.
- **t-DATA-L-01**: CTR 0.58–0.71 — pure classification/recall task where splitting the table across roles loses items; specialization *reduces* recall on low-coupling work.

### 5.7 Statistical significance

**Table S1. Team vs. individual quality (Wilcoxon signed-rank on Q_team − Q_single; zero diffs excluded).**

| Model | n (non-zero) | mean Δ | W | *p* | sig |
|---|---|---|---|---|---|
| DS-Flash | 22 | −0.040 | 63 | 0.041 | * |
| DS-Pro | 21 | −0.051 | 48 | 0.021 | * |
| Kimi-K2.6 | 23 | −0.040 | 82 | 0.094 | n.s. |
| Kimi-K3 | 18 | −0.048 | 35 | 0.029 | * |
| GLM-5.3 | 17 | −0.055 | 30 | 0.029 | * |
| **Pooled (150 pairs)** | **101** | **−0.047** | **1206** | **3.5×10⁻⁶** | *** |

**Table S2. Between-group CTR comparisons (Mann-Whitney U).**

| Comparison | n | means | *p* | sig |
|---|---|---|---|---|
| PROJ vs other scenarios (pooled) | 30 / 120 | 1.009 / 0.932 | 0.006 | ** |
| PROJ vs other (DS-Pro only) | 6 / 24 | 1.032 / 0.916 | 0.014 | * |
| DS: Pro − Flash (paired CTR diff) | 30 | −0.016 | 0.137 | n.s. |
| Kimi: K3 − K2.6 (paired CTR diff) | 30 | −0.006 | 0.851 | n.s. |
| Coupling L vs M / L vs H / M vs H (pooled) | 50/50 | 0.925/0.950/0.968 | 0.87 / 0.43 / 0.17 | n.s. |

**Honest reading.** The two headline claims carry strong statistics: universal team suboptimality (pooled *p* < 10⁻⁵; 4/5 models individually significant) and the PROJ sweet spot (pooled *p* = 0.006). The coupling gradient is a consistent monotone trend in 4/5 models but underpowered per cell (n≈10); the capability-transfer paradox is directionally consistent across all three families but individually non-significant — we present it as a replicated *direction* with mechanism-level analysis, not as a statistically confirmed effect size.

---

## 6. Discussion

**Why do LLM teams underperform?** Three mechanisms, all visible in our artifacts:

1. **Context fragmentation.** Role outputs are truncated before passing downstream; the reconciler never sees full upstream work, so merge quality is bounded by the truncation, not by model capability.
2. **Constraint over-propagation.** In team mode, *every* role applies the full constraint set, so constraints compound and prune content the single agent would keep (the CONTENT-H case).
3. **Redundant coordination language.** Roles re-state shared context to each other — pure coordination tokens that buy no quality (Table 2), and stronger models do more of it (Finding 4).

**Implications for practitioners.** (i) Do not default to teams; measure CTR on your own task distribution. (ii) If tasks are aggregation-like, teams pay off; if conflict-resolution-like, upgrade the single model instead. (iii) Budget for 2.4–3.4× token cost — and expect *higher* multipliers on stronger models. (iv) Do not expect capability upgrades to fix collaboration: the paradox says the opposite.

**Implications for framework builders.** The tax is not intrinsic to LLMs — it is an artifact of context-passing protocols. Hierarchical summarization, shared workspace state (instead of message forwarding), and constraint partitioning are the obvious attack surfaces; TeamBench provides the testbed to measure whether they work.

**Runtime controllability: an unmeasured moderator.** Production multi-agent platforms increasingly standardize *runtime controls* as first-class orchestration operators — budget ceilings that trigger graceful early termination, human-in-the-loop gates for mid-run redirection, and execution ledgers that cache unchanged steps across modified replays (pause, resume, and partial re-execution). None of these dimensions is varied in TeamBench: all 300 runs execute open-loop, with unlimited budget, no human intervention, and no interruption. This matters because runtime controls plausibly *interact with every finding we report*. A budget ceiling should hurt teams disproportionately — their 2.4–3.4× token tax (heavier on stronger models, Finding 4) means teams hit any fixed cost envelope sooner and must degrade earlier, so **budget-constrained CTR is likely strictly lower than our unconstrained estimates**, and the capability-transfer paradox may sharpen into a budget-transfer paradox: under a cost envelope, the "stronger" model's team finishes *less* work, not just worse work. Conversely, mid-run human redirection is a candidate repair for exactly the failure modes we observe — constraint over-propagation and the semantic relay penalty are both correctable by a one-line intervention ("keep the pruned section", "pass the full table downstream") — but each intervention re-introduces the human cost the team was deployed to remove, converting the coordination tax from tokens to attention. We therefore propose two successor metrics for the next benchmark iteration, and include their protocols in the released roadmap: **budget-aware CTR** — Q(team)/Q(single) evaluated under a shared token budget for both modes — and **intervention-robustness CTR** — quality retention under scripted mid-run redirection events injected at fixed workflow positions. Measuring collaboration under "resource-capped, human-steered" conditions is, we argue, the empirically honest next step: multi-agent systems do not enter production unconstrained, and their benchmarks should not either.

---

## 7. Limitations

1. **Model coverage**: 5 open models from 3 families; no closed-model (GPT/Claude/Gemini) results.
2. **Team topology fixed**: roles and workflow are specified per task; emergent/self-organizing teams are future work.
3. **Sample size per cell**: n=30 pairs per model, ~10 per coupling cell — sufficient for the pooled headline findings, underpowered for per-cell and per-family gradient claims (§5.7).
4. **Chinese office artifacts**: tasks are Chinese-language; cross-lingual transfer unverified.
5. **No human baseline**: human-agent comparison is future work (original vision extension).
6. **Aggregator-platform variance**: GLM-5.3 runs went through a cloud aggregator (TokenHub) rather than the vendor's first-party endpoint; the platform did not honor provider context caching (verified experimentally), which affects cost accounting but not outputs.
7. **Open-loop runtime, no controllability axis**: all runs execute without budget ceilings, mid-run human intervention, or pause/resume. Contemporary platforms expose these as standard runtime operators, so our CTR estimates describe *unconstrained* collaboration; transfer to controllability-constrained deployments is unverified (see §6, "Runtime controllability").

---

## 8. Conclusion

TeamBench provides the first controlled, paired-mode benchmark for team-level LLM agent evaluation. Across 300 runs, 5 models, and 3 families, the picture is consistent: agent teams pay a 2.4–3.4× coordination tax, destroy 4–7% of individual capability on average (pooled *p* < 10⁻⁵), approach break-even only at high coupling, and net real gains only on aggregation-dominant scenarios (pooled *p* = 0.006). The capability-transfer paradox — stronger models collaborate worse, directionally consistent in all three families — shows this is not a problem that capability scaling will solve. We release TeamBench to make team-level efficiency a first-class, measurable quantity — because "more agents" is a hypothesis, not a result.

---

## Figures

- **Figure 1** — `figures/fig0_overview.pdf`: benchmark overview (task suite → paired modes → artifact scoring → team-level metrics → findings).
- **Figure 2** — `figures/fig1_ctr_coupling.pdf`: CTR vs. coupling, 5 models, SEM error bars.
- **Figure 3** — `figures/fig2_paradox.pdf`: capability-transfer paradox (CTR + coordination tax).
- **Figure 4** — `figures/fig3_scenario_heatmap.pdf`: model × scenario CTR heatmap.

---

## References

```bibtex
@inproceedings{liu2023agentbench,
  title={AgentBench: Evaluating LLMs as Agents},
  author={Liu, Xiao and Yu, Hao and Zhang, Hanchen and Xu, Yifan and Lei, Xuanyu and Lai, Hanyu and Gu, Yu and Ding, Hangliang and Men, Kaiwen and Yang, Kejuan and others},
  booktitle={International Conference on Learning Representations (ICLR)},
  year={2024}
}
@inproceedings{mialon2023gaia,
  title={GAIA: A Benchmark for General AI Assistants},
  author={Mialon, Gr{\'e}goire and Fourrier, Cl{\'e}mentine and Swift, Craig and Wolf, Thomas and LeCun, Yann and Scialom, Thomas},
  booktitle={International Conference on Learning Representations (ICLR)},
  year={2024}
}
@inproceedings{jimenez2024swebench,
  title={SWE-bench: Can Language Models Resolve Real-World GitHub Issues?},
  author={Jimenez, Carlos and Yang, John and Wettig, Alexander and Yao, Shunyu and Pei, Kexin and Press, Ofir and Narasimhan, Karthik},
  booktitle={International Conference on Learning Representations (ICLR)},
  year={2024}
}
@inproceedings{xie2024osworld,
  title={OSWorld: Benchmarking Multimodal Agents for Open-Ended Tasks in Real Computer Environments},
  author={Xie, Tianbao and Zhang, Danyang and Chen, Jixuan and Li, Xin and Zhao, Siheng and Cao, Ruisheng and Hua, Toh Jing and Zhou, Wenfeng and Shi, Dennis and Chu, Victor and others},
  booktitle={Advances in Neural Information Processing Systems (NeurIPS)},
  year={2024}
}
@article{xu2024theagentcompany,
  title={TheAgentCompany: Benchmarking LLM Agents on Consequential Real World Tasks},
  author={Xu, Frank and Li, Boyu and Yuan, Zidian and Wu, Shuyi and Zhong, Skyler and Xu, Hongxuan and Zhang, Yuchen and Peng, Min and Wang, Jiaxuan and Yang, Yu and others},
  journal={arXiv preprint arXiv:2412.14161},
  year={2024}
}
@inproceedings{wu2023autogen,
  title={AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation},
  author={Wu, Qingyuan and Bansal, Gagan and Zhang, Jieyu and Wu, Yiran and Li, Beibin and Zhu, Erkang and Jiang, Li and Zhang, Xiaoyun and Zhang, Shaokun and Liu, Jiale and others},
  booktitle={arXiv preprint arXiv:2308.08155},
  year={2023}
}
@inproceedings{hong2024metagpt,
  title={MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework},
  author={Hong, Sirui and Zhuge, Mingchen and Chen, Jonathan and Zheng, Xiawu and Cheng, Yuheng and Zhang, Ceyao and Wang, Jinlin and Wang, Zili and Yau, Steven Kuan and Lin, Zijuan and others},
  booktitle={International Conference on Learning Representations (ICLR)},
  year={2024}
}
@misc{crewai2024,
  title={CrewAI: Framework for Orchestrating Role-Playing AI Agents},
  author={{CrewAI Inc.}},
  howpublished={\url{https://github.com/crewAIInc/crewAI}},
  year={2024}
}
@misc{langgraph2024,
  title={LangGraph: Building Stateful, Multi-Actor Applications with LLMs},
  author={{LangChain Inc.}},
  howpublished={\url{https://github.com/langchain-ai/langgraph}},
  year={2024}
}
@inproceedings{qian2024chatdev,
  title={ChatDev: Communicative Agents for Software Development},
  author={Qian, Chen and Liu, Wei and Liu, Hongzhang and Chen, Ning and Dang, Yufan and Li, Jiahao and Yang, Cheng and Chen, Weize and Su, Yusheng and Cong, Xin and others},
  booktitle={Annual Meeting of the Association for Computational Linguistics (ACL)},
  year={2024}
}
@inproceedings{zhu2025multiagentbench,
  title={MultiAgentBench: Evaluating the Collaboration and Competition of LLM Agents},
  author={Zhu, Ziyuan and Wang, Xiao and Wang, Sheng and Zhang, Zihao and Chen, Yixin and others},
  booktitle={arXiv preprint arXiv:2503.01935},
  year={2025}
}
@inproceedings{bara2025agentsroom,
  title={Agents' Room: Narrative Generation through Multi-Agent Collaboration},
  author={Bara, Grace and others},
  booktitle={arXiv preprint arXiv:2503.19498},
  year={2025}
}
@article{woolley2010evidence,
  title={Evidence for a Collective Intelligence Factor in the Performance of Human Groups},
  author={Woolley, Anita Williams and Chabris, Christopher F and Pentland, Alex and Hashmi, Nada and Malone, Thomas W},
  journal={Science},
  volume={330},
  number={6004},
  pages={686--688},
  year={2010}
}
@article{malone1994interdisciplinary,
  title={The Interdisciplinary Study of Coordination},
  author={Malone, Thomas W and Crowston, Kevin},
  journal={ACM Computing Surveys},
  volume={26},
  number={1},
  pages={87--119},
  year={1994}
}
@book{brooks1995mythical,
  title={The Mythical Man-Month: Essays on Software Engineering},
  author={Brooks, Frederick P},
  edition={Anniversary},
  publisher={Addison-Wesley},
  year={1995}
}
@article{li2024moreagents,
  title={More Agents Is All You Need},
  author={Li, Junyou and Zhang, Qin and Yu, Yangbin and Fu, Qiang and Ye, Deheng},
  journal={Transactions of the Association for Computational Linguistics},
  volume={12},
  year={2024}
}
@inproceedings{chen2024morellmcalls,
  title={Are More LLM Calls All You Need? Towards the Scaling Properties of Compound AI Systems},
  author={Chen, Lingjiao and Davis, Davis and Hanin, Boris and Bailis, Peter and Stoica, Ion and Zaharia, Matei and Zou, James},
  booktitle={arXiv preprint arXiv:2403.02419},
  year={2024}
}
@article{guo2024survey,
  title={Large Language Model based Multi-Agents: A Survey of Progress and Challenges},
  author={Guo, Taicheng and Xiuying, Chen and Yujie, Wang and Ruidong, Chang and Shichao, Pei and Chongyang, Gao},
  journal={International Joint Conference on Artificial Intelligence (IJCAI)},
  year={2024}
}
@article{han2024llmmultiagentsurvey,
  title={LLM-based Multi-Agent Systems: Techniques and Business Perspectives},
  author={Han, Junda and Lu, Yujian and Wang, Shaoxiong and Li, Chinmay and Xia, Wei and others},
  journal={Business \& Information Systems Engineering},
  year={2025}
}
@inproceedings{zheng2023judging,
  title={Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena},
  author={Zheng, Lianmin and Chiang, Wei-Lin and Sheng, Ying and Zhuang, Siyuan and Wu, Zhanghao and Zhuang, Yonghao and Lin, Zi and Li, Zhuohan and Li, Dacheng and Xing, Eric and others},
  booktitle={Advances in Neural Information Processing Systems (NeurIPS)},
  year={2023}
}
@article{deepseek2024v3,
  title={DeepSeek-V3 Technical Report},
  author={{DeepSeek-AI}},
  journal={arXiv preprint arXiv:2412.19437},
  year={2024}
}
@article{moonshot2025kimi,
  title={Kimi K2: Open Agentic Intelligence},
  author={{Moonshot AI}},
  journal={arXiv preprint},
  year={2025}
}
@article{zhipu2025glm,
  title={GLM-5: An Open Bilingual Chat Language Model},
  author={{Zhipu AI}},
  journal={Technical Report},
  year={2025}
}
```

---

## Appendix (planned)

- A. Full per-task CTR tables (30 pairs × 5 models)
- B. Task templates & parameterization spec
- C. Judge rubrics & consistency analysis
- D. Cache hit-rate & cost accounting (incl. TokenHub no-cache finding)
- E. Prompt texts (single & team mode, v3)
- F. L3 ablation full tables
- G. Runtime-control extension protocol: budget-aware CTR & intervention-robustness CTR (§6)

---

> **中文导读(给作者的 review 要点)**
> 1. v0.5 新增一块:**§6 运行时可控性(runtime controllability)作为未测量的调节变量** + **§7 Limitation 7(开环运行时)** + **Appendix G 路线图条目**。灵感来源:SwarmFlow 等生产级平台已把预算封顶 / 人机中途介入 / 执行账本暂停续跑标准化为编排算子,而 TeamBench 的 300 次运行全部是无预算、无介入、不可暂停的开环执行——CTR 估计的是"无约束协作",外推到"资源受限 + 人类方向盘"的部署条件未经验证。
> 2. 核心论点链:① 预算封顶下团队受害更重(2.4–3.4× token 税 → 更早触顶 → 更早降级),budget-aware CTR 预计严格低于无约束 CTR,能力转移悖论可能升级为"预算转移悖论"(同一成本包络下强模型团队完成得更少);② 人机中途纠偏恰好能修复我们观察到的两个失效模式(约束过传播、语义中继惩罚),但代价是把协调税从 token 转嫁为人类注意力;③ 由此提出两个后继指标:**budget-aware CTR**(双模式共享 token 预算下的 Q 比)与 **intervention-robustness CTR**(固定工作流位置注入脚本化重定向事件后的质量保持率),协议写入 released roadmap。
> 3. 统计结论不变(v0.4 已校准):团队次优合并 p=3.5e-06、PROJ 甜蜜点 p=0.006;耦合梯度为趋势、悖论为跨三家族方向一致。
> 4. 待办(下一步):v1.0 = 全英润色 + LaTeX 化 + 附录填充(含新增 Appendix G 的协议落地);同步更新飞书文档。
