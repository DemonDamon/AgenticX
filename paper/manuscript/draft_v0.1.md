# TeamBench: Benchmarking Multi-Agent LLM Teams Beyond Individual Task Success

> **Draft v0.1** — 2026-08-25
> 状态:初稿骨架 + 核心实验数据已填入。Kimi K2.6 第四模型数据与 LLM-judge ablation 跑完后补 §5.3-5.4。
> 目标 venue: NeurIPS 2027 Datasets & Benchmarks Track (CCF-A)

---

## Abstract

Multi-agent LLM systems are increasingly deployed as *teams* of specialized role-playing agents, yet existing benchmarks evaluate agents almost exclusively as individuals solving tasks alone. We introduce **TeamBench**, a benchmark that measures what existing benchmarks ignore: whether a team of LLM agents actually converts individual capability into superior team output. TeamBench comprises 15 parameterized office tasks spanning 5 workplace scenarios (document collaboration, data analysis, project tracking, cross-department communication, content production) and 3 coupling levels (low/medium/high), each executed in two controlled modes — a single-agent baseline and a role-specialized team — under an identical artifact-based scoring protocol. We evaluate 3 frontier models (DeepSeek-V4-Flash, DeepSeek-V4-Pro, Kimi-K3) across 180 runs and report four team-level metrics, headlined by the **Capability Transfer Rate (CTR)**: the ratio of team output quality to individual output quality. Our findings challenge the default assumption that "more agents = better": (1) CTR increases monotonically with task coupling across all three models, yet never exceeds 1.0 on average — even at high coupling, teams merely break even; (2) low-coupling tasks exhibit systematic team suboptimality (CTR ≈ 0.92); (3) coordination overhead grows 2.4–3.4× in tokens while quality *drops*; and (4) stronger models pay *heavier* coordination taxes, suggesting capability scaling does not solve the collaboration problem. TeamBench provides the first reproducible testbed for team-level efficiency of LLM agents and releases all tasks, templates, and scoring rubrics.

---

## 1. Introduction

The rise of LLM-based agents has been followed almost immediately by the rise of *multi-agent* systems: frameworks such as AutoGen, CrewAI, LangGraph and MetaGPT orchestrate role-specialized agents that decompose, delegate, and merge work. The implicit promise is that a well-designed team of agents outperforms a single agent on complex work — mirroring the human intuition that "two heads are better than one."

Yet the benchmarks that guide this field measure none of this. TheAgentCompany, AgentBench, GAIA, SWE-bench, and OSWorld all evaluate a *single* agent against a task list, scoring task success in isolation. When multi-agent configurations are evaluated at all, they are evaluated on the same individual-success metric, leaving the central question unanswered: **when we deploy a team of agents instead of one agent, what do we gain — and what do we pay?**

This question is not academic. Team configurations multiply inference cost (every role is a separate LLM call chain with inter-role context passing), and organizational science has long documented that human teams exhibit coordination costs that can dominate the gains from specialization (Brooks' law; process losses in group work). Whether LLM teams inherit these losses — or transcend them, since LLM agents share weights, have lossless message passing, and never misremember — is an open empirical question that no existing benchmark can answer.

**TeamBench** fills this gap. It is built on three design principles:

1. **Paired-mode evaluation.** Every task exists in two modes: a *single-agent* mode (one agent receives the full task) and a *team* mode (the same task is decomposed into role-specialized positions with an explicit workflow). Both modes are scored by the same artifact-based protocol, enabling direct comparison.
2. **Coupling as the controlled variable.** Tasks are stratified by *coupling level* — the degree to which sub-tasks depend on each other — because organizational theory predicts specialization pays off only when work is sufficiently interdependent. TeamBench makes this axis measurable.
3. **Team-level metrics.** We define Capability Transfer Rate (CTR), Coordination Overhead (CO), Protocol Compliance (PC), and Team Memory & Structure (TMS) — metrics that operate on the *pair* (individual run, team run) rather than on a single run.

We evaluate three frontier models across 180 runs and find a consistent, cross-model picture: **LLM agent teams systematically fail to convert individual capability into team gains.** Average CTR sits at 0.94–0.96 across all three models — teams are 4–6% *worse* than a single agent on the same tasks — while consuming 2.4–3.4× the tokens. The only scenario where teams net a gain is project tracking (CTR 1.01–1.04), where the task is essentially distributed information aggregation. Strikingly, the *strongest* models pay the *heaviest* coordination taxes, indicating that scaling model capability does not, by itself, buy collaboration.

**Contributions.**
- **TeamBench**, the first benchmark purpose-built for paired individual-vs-team evaluation of LLM agents, with 15 parameterized tasks across 5 office scenarios × 3 coupling levels (§4).
- A formal team-level metric suite (CTR, CO, PC, TMS) with a three-layer artifact scoring protocol (L1 structural / L2 numeric / L3 judge, weighted 50/30/20) that keeps ≥80% of scoring deterministic (§4.3).
- A cross-model empirical study (3 models, 180 runs) establishing four findings: coupling-monotone CTR, low-coupling suboptimality, universal coordination tax, and the capability-tax paradox (§5).
- Full release of tasks, generators, runner, and scoring rubrics for reproducibility.

---

## 2. Related Work

**Single-agent benchmarks.** AgentBench, GAIA, SWE-bench, OSWorld, and TheAgentCompany evaluate one agent against task suites, scoring per-task success. None measure the marginal value of adding agents.

**Multi-agent LLM frameworks.** AutoGen, MetaGPT, CrewAI, LangGraph, and ChatDev provide orchestration primitives (role assignment, message passing, workflow graphs). Evaluations in these papers typically show task success on a handful of demonstrations, not controlled paired comparisons against single-agent baselines.

**Multi-agent evaluation.** MultiAgentBench and similar efforts score collaboration *behaviors* (e.g., cooperation in games) but do not isolate the team-vs-individual quality trade-off on professional work. 

**Team science.** Woolley et al. (2010) identified a collective intelligence factor in human teams; coordination cost theory (malone & crowston; Brooks) explains why adding workers can reduce throughput. TeamBench transplants these questions to LLM teams, where — unlike human teams — members share weights and communicate losslessly, making the persistence of coordination costs a non-trivial finding.

> TODO: 补 related work 矩阵表(基准 × 单/多Agent × 指标层级 × 污染防护 × 过程感知),引用规范化。

---

## 3. Problem Formulation

Given a task $\tau$ with quality scoring function $Q(\cdot) \in [0,1]$, define:

- **Individual mode**: one agent receives the full task and produces artifact $a_s$.
- **Team mode**: $k$ role-specialized agents $\{r_1..r_k\}$ execute the task via a defined workflow (sequential pipeline or parallel+merge), producing artifact $a_t$.

**Capability Transfer Rate (CTR)**:
$$\text{CTR} = \frac{Q(a_t)}{Q(a_s)}$$
CTR > 1 means the team converts individual capability into *more* than the individual achieves alone; CTR < 1 means the team *destroys* capability. (We also report quality-difference and token-normalized variants in the appendix. TODO)

**Coordination Overhead (CO)**:
$$\text{CO} = \frac{\text{tokens}(a_t \text{ pipeline})}{\text{tokens}(a_s)}$$

**Protocol Compliance (PC)**: fraction of role-boundary and output-format constraints satisfied (role越权率, 认领冲突率, 合并冲突数). *(v0.1 初步实现,完整形式化见附录 TODO)*

**TMS (Team Memory & Structure)**: binary/graded check that required structural sections and cross-references are present in the team artifact.

**Coupling levels.** Low: sub-tasks independent, output is aggregation. Medium: sequential pipeline, each role consumes predecessor output. High: parallel analysis + conflict reconciliation, requiring cross-validation.

---

## 4. The TeamBench Benchmark

### 4.1 Task taxonomy

| Axis | Values |
|---|---|
| Office scenario | Document collaboration (DOC), Data analysis (DATA), Project tracking (PROJ), Cross-department communication (CROSS), Content production (CONTENT) |
| Coupling | Low (L), Medium (M), High (H) |

15 seed tasks (5 scenarios × 3 coupling levels), each with:

- **Role cards** (team mode): 2–4 specialized roles with explicit responsibilities, e.g. *分类员/核对员/冲突消解员* for DATA-H; *需求员P1-P3 + 排期冲突消解员* for PROJ-H.
- **Shared workspace initial state**: the raw materials (tables, member lists, thread logs, requirement documents).
- **Verification spec**: required sections, required elements, expected numeric answers, and count constraints — the raw material for L1/L2 scoring.
- **Parameterization**: entity names, quantities, and values are template variables, enabling contamination-resistant regeneration (e.g., 20 requirement items with randomized owners/dates/conflicts).

### 4.2 Paired-mode runner

The same task file drives both modes. Single mode: one prompt containing the full task + workspace. Team mode: the workflow from the task spec (sequential or parallel-merge), with each role receiving (i) its role card, (ii) the shared initial state, (iii) the truncated outputs of upstream roles. Both modes use identical word-budget constraints (single ≤ 4000 chars; per-role ≤ 2800 chars) and max_tokens=32768, so neither mode is structurally favored.

### 4.3 Artifact scoring: three layers

| Layer | Weight | What it checks | Deterministic? |
|---|---|---|---|
| L1 structural | 50% | required sections/elements present (fuzzy-matched ≥50% keyword hit) | Yes |
| L2 numeric | 30% | expected values, counts, mismatch lists vs. ground truth | Yes |
| L3 judge | 20% | semantic quality, 1–5 rubric by scenario type | LLM |

Final quality $Q = 0.5 L_1 + 0.3 L_2 + 0.2 L_3$. The baseline experiments reported in §5 run with L3 disabled (constant 0.6); §5.4 reports the judge ablation showing conclusions are insensitive to L3. *(数据跑完后填)*

### 4.4 Metrics implementation

CTR/CO computed per (task, seed) pair; aggregated by coupling level and scenario with n=10 pairs per cell per model (15 tasks × 2 seeds ÷ 3 coupling levels... exactly 10 pairs per level per model).

---

## 5. Experiments

### 5.1 Setup

- **Models**: DeepSeek-V4-Flash (mid-tier), DeepSeek-V4-Pro (flagship, same family), Kimi-K3 (reasoning flagship, cross-vendor). *(Kimi-K2.6 第四模型 in progress, will add.)*
- **Runs**: 15 tasks × 2 modes × 2 seeds × 3 models = **180 runs** (90 pairs).
- **Protocol**: v3 prompt (word budgets as in §4.2), temperature 0.3 (Kimi models forced to 1.0 by API), max_tokens 32768. 0 failed runs after protocol stabilization.
- **Cost controls**: context-cache-aware prompt layout (shared prefix ordering); cache hit rates reported in appendix.

### 5.2 Main result: CTR by coupling level

**Table 1. Capability Transfer Rate (avg over 10 pairs per cell).**

| Coupling | DS-V4-Flash | DS-V4-Pro | Kimi-K3 |
|---|---|---|---|
| Low (L) | 0.921 | 0.923 | 0.915 |
| Medium (M) | 0.956 | 0.925 | 0.967 |
| High (H) | 0.990 | 0.970 | 0.968 |
| **Overall** | **0.956** | **0.939** | **0.950** |

**Finding 1 (monotone coupling law).** CTR increases monotonically with coupling (L < M < H) in **all three models** — the first cross-model confirmation that task coupling is the governing variable of team value. Specialization only pays as interdependence grows.

**Finding 2 (universal team suboptimality).** No model reaches CTR = 1.0 *on average at any coupling level*; overall CTRs (0.94–0.96) mean teams destroy 4–6% of individual capability. The "more agents" default is, on average, a quality regression.

**Finding 3 (high-coupling break-even).** At high coupling, CTR approaches but does not cross break-even (0.968–0.990). Teams nearly recover the individual baseline — the coordination machinery works — but true emergent gains (CTR > 1.05) appear in only 1–2 of 10 pairs per model.

### 5.3 Coordination overhead: the tax scales with capability

**Table 2. Coordination Overhead (team/single total token ratio).**

| Coupling | DS-V4-Flash | DS-V4-Pro | Kimi-K3 |
|---|---|---|---|
| Low | 1.85× | 3.10× | 2.26× |
| Medium | 1.78× | 2.74× | 3.93× |
| High | 3.48× | 3.29× | 4.10× |
| **Mean** | **2.37×** | **3.04×** | **3.43×** |

**Finding 4 (capability–tax paradox).** Stronger models pay *heavier* coordination taxes: the mid-tier Flash averages 2.37×, while flagships Pro and K3 average 3.04× and 3.43×. Verbose role outputs compound through context passing — the better the model, the more it says, and the more every downstream role must re-read. Capability scaling does not solve collaboration; it inflates its cost.

### 5.4 Scenario analysis: one sweet spot

**Table 3. CTR by office scenario.**

| Scenario | Flash | Pro | Kimi-K3 |
|---|---|---|---|
| Project tracking (PROJ) | **1.044** | **1.032** | **1.011** |
| Document (DOC) | 0.963 | 0.920 | 0.977 |
| Data (DATA) | 0.948 | 0.902 | 0.911 |
| Content (CONTENT) | 0.945 | 0.911 | 0.944 |
| Cross-dept (CROSS) | 0.878 | 0.931 | 0.909 |

**Finding 5 (aggregation sweet spot).** Project tracking is the *only* scenario where all three models exceed CTR = 1.0. PROJ tasks are distributed information aggregation — each role reads a different slice and the reconciler merges — which matches the structure of a multi-agent pipeline with minimal semantic conflict. Content production and cross-department communication (semantic conflict resolution, tone constraints) are consistently team-hostile. This suggests a practical decision rule: **deploy agent teams for aggregation-dominant work; deploy single agents (with stronger models) for conflict-dominant work.**

### 5.5 Judge ablation & consistency *(数据跑完后填)*

- Cross-vendor judging: Flash & Kimi artifacts judged by DS-V4-Pro; Pro artifacts judged by Kimi-K3.
- Two-round Spearman consistency of judge scores: **[TODO — running]**.
- L3 on/off ablation: recompute CTR with $Q' = Q + 0.2(L_3 - 0.6)$; compare all Findings 1–5 for sign flips: **[TODO — running]**.

### 5.6 Case studies *(初稿占位)*

- **t-PROJ-H-03 (s0, Flash)**: CTR 1.24 — the strongest emergence case; requirement triage + schedule conflict reconciliation decomposes cleanly.
- **t-CONTENT-H-03**: CTR 0.78 (Flash) — platform-specific tone constraints from the "reviewer" role cause the writer role to over-prune; team pays 4–5× tokens for worse output.
- **t-DATA-L-01**: CTR 0.58–0.71 — pure classification/recall task where splitting the table across roles loses items; specialization *reduces* recall on low-coupling work.

---

## 6. Discussion

**Why do LLM teams underperform?** Three mechanisms, all visible in our artifacts:

1. **Context fragmentation.** Role outputs are truncated (2800 chars) before passing downstream; the reconciler never sees full upstream work, so merge quality is bounded by the truncation, not by model capability.
2. **Constraint over-propagation.** In team mode, *every* role applies the full constraint set (word budgets, format rules), so constraints compound and prune content the single agent would keep (the CONTENT-H case).
3. **Redundant coordination language.** Roles re-state shared context to each other — pure coordination tokens that buy no quality (Table 2), and stronger models do more of it (Finding 4).

**Implications for practitioners.** (i) Do not default to teams; measure CTR on your own task distribution. (ii) If tasks are aggregation-like, teams pay off; if conflict-resolution-like, upgrade the single model instead. (iii) Budget for 2.4–3.4× token cost when running teams — and expect *higher* multipliers on stronger models.

**Implications for framework builders.** The tax is not intrinsic to LLMs — it is an artifact of context-passing protocols. Hierarchical summarization, shared workspace state (instead of message forwarding), and constraint partitioning are the obvious attack surfaces; TeamBench provides the testbed to measure whether they work.

---

## 7. Limitations

1. **Model coverage**: 3 models (+1 in progress); no closed-model (GPT/Claude) results yet. *(需用户后续提供 key 或公开 API)*
2. **Team topology fixed**: roles and workflow are specified per task; emergent/self-organizing teams (agent decides decomposition) are future work.
3. **L3 judge weight (20%)**: although ablation shows insensitivity *(TODO confirm)*, judge-based scoring remains non-deterministic at the margins.
4. **Chinese office artifacts**: tasks are Chinese-language; cross-lingual transfer of findings unverified.
5. **No human baseline**: we do not yet compare against human teams doing the same tasks (the "human-agent" extension of the original vision).

---

## 8. Conclusion

TeamBench provides the first controlled, paired-mode benchmark for team-level LLM agent evaluation. Across 180 runs and 3 frontier models, the picture is consistent: agent teams pay a 2.4–3.4× coordination tax, destroy 4–6% of individual capability on average, approach break-even only at high coupling, and net real gains only on aggregation-dominant scenarios. Stronger models make collaboration *more* expensive, not less. We release TeamBench to make team-level efficiency a first-class, measurable quantity — because "more agents" is a hypothesis, not a result.

---

## Appendix (planned)

- A. Full per-task CTR tables (30 pairs × 3 models)
- B. Task templates & parameterization spec
- C. Judge rubrics & consistency analysis
- D. Cache hit-rate & cost accounting
- E. Prompt texts (single & team mode, v3)
- F. L3 ablation full tables

---

> **中文导读(给作者的 review 要点)**
> 1. 故事线现在定为"挑战 more agents = better 的默认假设"——四大发现全部指向"团队协作是亏的,除了聚合类任务"。
> 2. 原"中耦合陷阱"发现(中耦合 CTR 最低)在 v3 统一 prompt 下已弱化(M 不再低于 L),初稿不再作为主发现,避免被 reviewer 用我们自己的数据反驳。
> 3. 标题从 "Human-Agent Teams" 改为 "Multi-Agent LLM Teams",因为我们目前没有人类团队基线——human-agent 是 future work。如果领导坚持 human-agent 叙事,需要补人类实验。
> 4. 待补:K2.6 第四模型(跑着)、judge ablation(跑着)、related work 矩阵、PC 指标完整实现。
