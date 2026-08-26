# TeamBench: Benchmarking Multi-Agent LLM Teams Beyond Individual Task Success

> **Draft v0.2** — 2026-08-25
> 相比 v0.1:新增 Kimi-K2.6 第四模型(双家族梯度验证)、修正五大发现、新增家族内能力梯度发现。
> 状态:LLM-judge 一致性 + L3 ablation 后台运行中,§5.5 待填。其余章节数据已定稿。
> 目标 venue: NeurIPS 2027 Datasets & Benchmarks Track (CCF-A)

---

## Abstract

Multi-agent LLM systems are increasingly deployed as *teams* of specialized role-playing agents, yet existing benchmarks evaluate agents almost exclusively as individuals solving tasks alone. We introduce **TeamBench**, a benchmark that measures what existing benchmarks ignore: whether a team of LLM agents actually converts individual capability into superior team output. TeamBench comprises 15 parameterized office tasks spanning 5 workplace scenarios and 3 coupling levels, each executed in two controlled modes — a single-agent baseline and a role-specialized team — under an identical artifact-based scoring protocol. We evaluate **4 models from 2 families** (DeepSeek-V4-Flash/Pro, Kimi-K2.6/K3) across **240 runs / 120 paired comparisons**, headlined by the **Capability Transfer Rate (CTR)**: the ratio of team output quality to individual output quality. Our findings challenge the default assumption that "more agents = better": (1) CTR rises with task coupling in 3 of 4 models, yet never exceeds 1.0 on average — teams destroy 4–6% of individual capability across all four models; (2) coordination overhead grows 2.4–3.4× in tokens; (3) **stronger models pay heavier coordination taxes and transfer capability worse** — a gradient replicated independently in both model families; and (4) project-tracking (aggregation-dominant) is the only scenario where teams break even or win, across all four models. TeamBench provides the first reproducible testbed for team-level efficiency of LLM agents and releases all tasks, templates, and scoring rubrics.

---

## 1. Introduction

The rise of LLM-based agents has been followed almost immediately by the rise of *multi-agent* systems: frameworks such as AutoGen, CrewAI, LangGraph and MetaGPT orchestrate role-specialized agents that decompose, delegate, and merge work. The implicit promise is that a well-designed team of agents outperforms a single agent on complex work — mirroring the human intuition that "two heads are better than one."

Yet the benchmarks that guide this field measure none of this. TheAgentCompany, AgentBench, GAIA, SWE-bench, and OSWorld all evaluate a *single* agent against a task list, scoring task success in isolation. When multi-agent configurations are evaluated at all, they are evaluated on the same individual-success metric, leaving the central question unanswered: **when we deploy a team of agents instead of one agent, what do we gain — and what do we pay?**

This question is not academic. Team configurations multiply inference cost, and organizational science has long documented that human teams exhibit coordination costs that can dominate the gains from specialization. Whether LLM teams inherit these losses — or transcend them, since LLM agents share weights, pass messages losslessly, and never misremember — is an open empirical question that no existing benchmark can answer.

**TeamBench** fills this gap with three design principles:

1. **Paired-mode evaluation.** Every task exists in two modes: a *single-agent* mode and a *team* mode (role-specialized positions with an explicit workflow). Both modes are scored by the same artifact-based protocol, enabling direct comparison.
2. **Coupling as the controlled variable.** Tasks are stratified by *coupling level* — the degree to which sub-tasks depend on each other — because organizational theory predicts specialization pays off only when work is sufficiently interdependent.
3. **Team-level metrics.** We define Capability Transfer Rate (CTR), Coordination Overhead (CO), Protocol Compliance (PC), and Team Memory & Structure (TMS) — metrics that operate on the *(individual, team)* pair rather than on a single run.

We evaluate four models from two families across 240 runs and find a consistent picture: **LLM agent teams systematically fail to convert individual capability into team gains.** Average CTR sits at 0.939–0.957 across all four models — teams are 4–6% *worse* than a single agent on the same tasks — while consuming 2.4–3.4× the tokens. Crucially, this is not a capability problem: in *both* families, the stronger model transfers capability *worse* (DeepSeek: Flash 0.956 → Pro 0.939; Kimi: K2.6 0.957 → K3 0.950) while paying a *heavier* coordination tax. Scaling model capability does not buy collaboration.

**Contributions.**
- **TeamBench**, the first benchmark purpose-built for paired individual-vs-team evaluation of LLM agents: 15 parameterized tasks across 5 office scenarios × 3 coupling levels (§4).
- A formal team-level metric suite (CTR, CO, PC, TMS) with a three-layer artifact scoring protocol (L1 structural / L2 numeric / L3 judge, weighted 50/30/20) that keeps ≥80% of scoring deterministic (§4.3).
- A cross-model empirical study (4 models, 2 families, 240 runs) establishing five findings, including the **capability-transfer paradox** — stronger models collaborate *worse* — replicated independently within two model families (§5).
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

CTR/CO computed per (task, seed) pair; aggregated by coupling level and scenario with n=10 pairs per cell per model (120 pairs total across 4 models).

---

## 5. Experiments

### 5.1 Setup

- **Models (2 families, 4 capability tiers)**: DeepSeek-V4-Flash (mid-tier), DeepSeek-V4-Pro (family flagship), Kimi-K2.6 (mid-tier), Kimi-K3 (reasoning flagship).
- **Runs**: 15 tasks × 2 modes × 2 seeds × 4 models = **240 runs (120 pairs)**. 0 failed runs after protocol stabilization.
- **Protocol**: v3 prompt (word budgets as in §4.2), temperature 0.3 (Kimi models forced to 1.0 by API), max_tokens 32768, cache-aware prompt layout.

### 5.2 Main result: CTR by coupling level

**Table 1. Capability Transfer Rate (avg over 10 pairs per cell).**

| Coupling | DS-Flash | DS-Pro | Kimi-K2.6 | Kimi-K3 |
|---|---|---|---|---|
| Low (L) | 0.921 | 0.923 | 0.950 | 0.915 |
| Medium (M) | 0.956 | 0.925 | 0.961 | 0.967 |
| High (H) | 0.990 | 0.970 | 0.958 | 0.968 |
| **Overall** | **0.956** | **0.939** | **0.957** | **0.950** |
| Monotone L<M<H | ✓ | ✓ | ✗ (flat) | ✓ |

**Finding 1 (coupling law, 3/4 models).** CTR rises with coupling (L < M < H) in Flash, Pro, and K3 — task coupling is the governing variable of team value. The weakest model (K2.6) shows a flat profile (0.950/0.961/0.958): coupling sensitivity itself appears to require a capability threshold.

**Finding 2 (universal team suboptimality).** No model reaches CTR = 1.0 on average; overall CTRs (0.939–0.957) mean teams destroy 4–6% of individual capability. The "more agents" default is, on average, a quality regression — across every capability tier tested.

**Finding 3 (high-coupling break-even).** At high coupling, CTR approaches but does not cross break-even (0.958–0.990). True emergent gains (CTR > 1.05) appear in only 1–2 of 10 pairs per model.

### 5.3 The capability-transfer paradox: within-family gradients

**Table 2. Overall CTR and Coordination Overhead by model (family-ordered).**

| Model | Tier | Overall CTR | Mean CO (token ratio) |
|---|---|---|---|
| DS-V4-Flash | mid | 0.956 | 2.37× |
| **DS-V4-Pro** | flagship | **0.939** ↓ | **3.04×** ↑ |
| Kimi-K2.6 | mid | 0.957 | 3.01× |
| **Kimi-K3** | reasoning flagship | **0.950** ↓ | **3.43×** ↑ |

**Finding 4 (capability-transfer paradox, double-family replication).** Within *each* family, the stronger model transfers capability *worse* and pays a *heavier* coordination tax:
- DeepSeek: Flash → Pro: CTR −0.017, CO +0.67×
- Kimi: K2.6 → K3: CTR −0.007, CO +0.42×

Two mechanisms compound: (i) flagship single-agent quality approaches the scoring ceiling, leaving no headroom for team gains; (ii) stronger models produce more verbose role outputs, which compound through inter-role context passing — every downstream role must re-read more coordination language that buys no quality. **Capability scaling does not solve collaboration; it inflates its cost.** This is the paper's most actionable negative result: practitioners cannot buy their way out of the coordination tax by upgrading models.

### 5.4 Scenario analysis: one sweet spot

**Table 3. CTR by office scenario (family-ordered columns).**

| Scenario | DS-Flash | DS-Pro | Kimi-K2.6 | Kimi-K3 |
|---|---|---|---|---|
| Project tracking (PROJ) | **1.044** | **1.032** | **0.986** | **1.011** |
| Document (DOC) | 0.963 | 0.920 | 0.953 | 0.977 |
| Data (DATA) | 0.948 | 0.902 | 0.937 | 0.911 |
| Content (CONTENT) | 0.945 | 0.911 | 0.931 | 0.944 |
| Cross-dept (CROSS) | 0.878 | 0.931 | 0.975 | 0.909 |

**Finding 5 (aggregation sweet spot).** Project tracking is the top scenario for **all four models** — the only cell where three of four models exceed CTR = 1.0 and the fourth nearly breaks even (0.986). PROJ tasks are distributed information aggregation — each role reads a different slice and the reconciler merges — matching the structure of a multi-agent pipeline with minimal semantic conflict. Content production and data analysis (semantic constraint resolution, recall-critical splitting) are consistently team-hostile. Practical decision rule: **deploy agent teams for aggregation-dominant work; deploy a single stronger agent for conflict-dominant work.**

**TMS structural compliance** follows the same pattern: e.g. K2.6 single→team 83%→63%; team workflows lose required structural sections relative to single agents (context fragmentation), never gain them.

### 5.5 Cross-vendor judge ablation *(数据收尾中,跑完填)*

- Judging matrix (avoiding self-preference): Flash & Kimi artifacts judged by DS-V4-Pro; Pro artifacts judged by Kimi-K3.
- Judge consistency (temperature-0 determinism check): **[running]**
- L3 on/off ablation: recompute CTR with $Q' = Q + 0.2(L_3 - 0.6)$; check all Findings 1–5 for sign flips: **[running]**

### 5.6 Case studies

- **t-PROJ-H-03**: the benchmark's strongest emergence case — CTR 1.24 on *both* Flash and K2.6 (requirement triage + schedule conflict reconciliation decomposes cleanly). When teams win, they win here.
- **t-CONTENT-H-03**: CTR 0.78 (Flash) — platform-specific tone constraints from the "reviewer" role cause the writer to over-prune; team pays 4–5× tokens for worse output.
- **t-DATA-L-01**: CTR 0.58–0.71 — pure classification/recall task where splitting the table across roles loses items; specialization *reduces* recall on low-coupling work.
- **K2.6 timeout anecdote**: the longest high-coupling task (PROJ-H-03 team, 4-role serial pipeline) repeatedly timed out on the weakest model — an extreme instance of context-compounding cost; it succeeded only on retry, at CTR 1.24.

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

1. **Model coverage**: 4 open models from 2 families; no closed-model (GPT/Claude/Gemini) results.
2. **Team topology fixed**: roles and workflow are specified per task; emergent/self-organizing teams are future work.
3. **L3 judge weight (20%)**: ablation pending (§5.5); judge-based scoring remains non-deterministic at the margins.
4. **Chinese office artifacts**: tasks are Chinese-language; cross-lingual transfer unverified.
5. **No human baseline**: human-agent comparison is future work (original vision extension).

---

## 8. Conclusion

TeamBench provides the first controlled, paired-mode benchmark for team-level LLM agent evaluation. Across 240 runs, 4 models, and 2 families, the picture is consistent: agent teams pay a 2.4–3.4× coordination tax, destroy 4–6% of individual capability on average, approach break-even only at high coupling, and net real gains only on aggregation-dominant scenarios. The capability-transfer paradox — stronger models collaborate worse, replicated in both families — shows this is not a problem that capability scaling will solve. We release TeamBench to make team-level efficiency a first-class, measurable quantity — because "more agents" is a hypothesis, not a result.

---

## Appendix (planned)

- A. Full per-task CTR tables (30 pairs × 4 models)
- B. Task templates & parameterization spec
- C. Judge rubrics & consistency analysis
- D. Cache hit-rate & cost accounting
- E. Prompt texts (single & team mode, v3)
- F. L3 ablation full tables

---

> **中文导读(给作者的 review 要点)**
> 1. v0.2 核心升级:K2.6 补齐后形成**双家族能力梯度**(Flash→Pro, K2.6→K3),两个家族独立复现"越强协作越差+税越重",这是全文最硬的 contribution(Finding 4)。
> 2. K2.6 是四模型中唯一耦合度不单调的(平坦),写成"耦合敏感性需要能力门槛"——诚实且有价值。
> 3. PROJ 甜蜜点在四模型全部保持第一名(Finding 5),实践指导性强。
> 4. 故事线:"more agents 是假设不是结论" + "能力升级买不来协作"。
> 5. 待办:judge §5.5(跑着)、related work 矩阵、PC 指标完整实现、BibTeX、图表绘制(CTR×耦合度折线图、双家族梯度对比图)。
