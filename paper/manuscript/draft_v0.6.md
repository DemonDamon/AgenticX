# TeamBench: Assembly Protocol, Not Model Capability, Determines Whether LLM Agent Teams Pay Off

> **Draft v0.6** — 2026-08-29
> 相对 v0.5：全部结论句作废重写；提升"装配协议"为一等受控变量与主因；补充算力对齐基线、指标完整性事件与诚实方法学自述；新增 §4.x/y。
> 当前数字来自 **pilot v1（DS v4 Flash × 15 任务 × 3 seeds × 7 臂，L2 未生效）**，待 pilot v2 跑完后按 `<!-- src: v2 -->` 标记替换。
> 目标 venue：NeurIPS 2027 Datasets & Benchmarks Track (CCF-A)

---

## Abstract

Multi-agent LLM frameworks orchestrate specialized role-playing agents for complex work, yet evaluations of these systems report contradictory conclusions. We identify an overlooked confounder: **no existing study controls or even reports how team outputs are assembled from their constituent roles.** We introduce **TeamBench**, a paired individual-vs-team benchmark comprising 15 parameterized office tasks across 5 workplace scenarios × 3 coupling levels, evaluated across 7 arms: a naïve single agent, two compute-matched single baselines (k-round self-revision and best-of-k), and four assembly protocols (last-role output, deterministic concatenation, a dedicated integrator role, and section-slot blackboard). We exhaustively run all 7 arms on DeepSeek-V4-Flash over 315 runs with Wilcoxon-signed-rank tests and bootstrap CIs. **Assembly protocol is the dominant factor** in Capability Transfer Rate (CTR, team quality over compute-matched single quality): CTR_matched ranges from 0.85 (last-role) to **1.54 (integrator)** on the same set of role outputs, with CTR_matched bootstrap 95% CI [1.38, 1.73] for the integrator arm (p = 6.7×10⁻⁷ vs refine-k, Cliff's d = +0.59) <!-- src: paper/experiments/v2/pilot_flash/pairs.csv + stats_v2 -->. Strikingly, neither k-round self-revision (CTR 0.95, 4.1× tokens) nor best-of-k (CTR 0.98, 4.2× tokens) achieves the gains of team collaboration under the correct assembly—specialization with semantic integration is qualitatively different from more sampling or more rounds. We also report a measurement-integrity episode: the blackboard protocol mechanically produced correct section headings without content, trivially gaming a structure-only L1 rubric in an earlier scorer version; we fix this via content-aware section scoring and publish the incident. All tasks, parameterized generators, runners, and scoring rubrics are released.

---

## 1. Introduction

Frameworks for multi-agent LLM systems—AutoGen, CrewAI, LangGraph, MetaGPT—promise that role-specialized teams outperform a single agent on complex work. Yet the empirical evidence is deeply contradictory. Some studies report monotonic gains from more agents; others find teams degrade quality; many of these papers run on non-overlapping task suites and none control for assembly. This paper argues that a large share of the contradiction is not about model capability—it is about how the final team artifact is produced from role outputs, a step rarely documented and **never before treated as a controlled variable in LLM team evaluation.**

We arrived at this hypothesis through our own work. In an earlier TeamBench version (now obsolete), we adopted the engineering default of taking the last role's output as the team's artifact, and reached the headline conclusion that LLM agent teams systematically underperform individuals. But when we varied only the assembly step—leaving role prompts, task inputs, and LLM calls identical—the measured CTR swung from 0.80 to 1.45, i.e., a 0.65 point effect size attributable solely to how outputs are concatenated. The "team inferiority" finding had been a pipeline artifact, not an empirical law.

**TeamBench** is a re-grounding of this question with three design principles.

1. **Paired-mode evaluation with assembly protocol as a first-class variable.** Every task runs in both individual mode and team mode; within team mode we explicitly compare four assembly protocols — last, concat, integrator, blackboard — over identical role outputs so assembly effects are isolated.
2. **Compute-matched single-agent baselines.** Teams consume k LLM calls. We compare them not only against a 1-shot single agent but also against k-round self-revision and best-of-k selection, so any team win cannot be dismissed as "just using more compute."
3. **Artifact scoring with a measurement-integrity contract.** We score each delivery along three layers: L1 structural (now content-aware, §4), L2 factual over structured answer blocks, L3 semantic via an LLM judge. The code documents every rubric change; we do not bury gaming incidents.

**Contributions.**

- **TeamBench**, the first paired individual-vs-team benchmark that controls *how* team outputs are assembled: 15 tasks across 5 office scenarios × 3 coupling levels, with 150 parameterized task variants, 7 evaluation arms, and a runner with breakpoint-resume, balance-guard, and deterministic rescore tools.
- An **artifact scoring protocol** with a documented measurement-integrity correction; ≥ 80% of scoring weight is deterministic; closed-form definitions of Capability Transfer Rate (CTR), Coordination Overhead (CO), and Team Memory & Structure (TMS), consistent across paper, code, and metrics docs.
- An empirical study (DS v4 Flash, 15 tasks × 3 seeds × 7 arms = 315 runs) showing that **assembly protocol dominates CTR variance**, integrator-assembled teams significantly outperform compute-matched single baselines (CTR_matched 1.54, 95% CI [1.38, 1.73], p = 6.7×10⁻⁷, d = +0.59) while burning ~2× tokens, and naive engineering defaults (last-role) produce artifactual "team-inferiority" effects. <!-- src: paper/experiments/v2/pilot_flash/pairs.csv + rescore v2.2 -->
- A negative result on structured assembly: deterministic section-slot (blackboard) and raw concatenation both perform near or below the single baseline, because LLMs write role-specific rather than schema-matching headings; only the semantic integrator normalizes these free-form outputs.
- Full release of tasks, parameterized generators, runner infrastructure, and scoring rubrics.

---

## 2. Related Work

### 2.1 Comparison matrix

**Table R1. TeamBench vs. prior agent benchmarks and multi-agent studies.**

| Benchmark | Paired single vs team | Assembly protocol controlled | Compute-matched baselines | Team-level metrics | Coupling axis | Contamination defense |
|---|---|---|---|---|---|---|
| AgentBench [6] | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| GAIA [7] | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| SWE-bench [8] | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| OSWorld [9] | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| TheAgentCompany [10] | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| More Agents Is All You Need [19] | ✗ | ✗ | partial (k agents vs 1, not compute-matched) | single-metric | ✗ | ✗ |
| More LLM Calls All You Need [20] | ✗ | ✗ | ✓ (budget-steps grid) | single-metric | ✗ | ✗ |
| MultiAgentBench [16] | ✗ | ✗ | ✗ | behavior scores | ✗ | ✗ |
| Agents' Room [17] | ✗ | ✗ | ✗ | per-task quality | ✗ | ✗ |
| Why MA Systems Fail [Cemri et al. 2025] | ✗ | ✗ | ✗ | failure taxonomy | ✗ | ✗ |
| **TeamBench (ours)** | **✓** | **✓ (4 protocols, controlled)** | **✓ (refine-k, best-of-k)** | **CTR / CO / TMS** | **✓ (L/M/H)** | **✓ (parameterized)** |

### 2.2 Single-agent benchmarks & office-scenario evaluation

AgentBench [6], GAIA [7], SWE-bench [8], OSWorld [9] evaluate a *single* agent per task on success-oriented rubrics. TheAgentCompany [10] closest to us in task flavor (office work) but does not report the marginal value of adding agents.

### 2.3 Multi-agent systems and their evaluation

Orchestration frameworks [11–15] report demo success rather than controlled paired comparisons. Recent scaling studies: "More Agents…" [19] and "More LLM Calls…" [20] study *performance scaling with agent count / LLM-call count* on single-success metrics, without separating specialization gains from compute gains. MultiAgentBench [16] scores collaboration behaviors, not quality transfer. Agents' Room [17] provides a structural existence proof. Cemri et al. **Why Do Multi-Agent LLM Systems Fail?** [to cite, 2025] contribute a MAST taxonomy of failures, including assembly-stage bugs; our work complements this by quantifying how *a single class* (output assembly) dominates end-to-end quality variance across a controlled task space.

### 2.4 Team science, coordination cost, and aggregation

Coordination theory and Brooks' law explain why adding human workers can reduce throughput; TeamBench transplants this to LLM teams where members share weights and pass messages losslessly. Debate, self-consistency, and majority voting evaluate answer aggregation of *independent answers to the same question.* Assembly protocols aggregate *non-overlapping role slices of a complex document* into a single artifact—a qualitatively different problem of semantic alignment, structure, and completeness.

### 2.5 LLM-as-judge

We follow MT-Bench-style judging at temperature 0 and adopt the cross-vendor judge matrix and on/off ablation pattern from v0.5 §5.5, renaming to §5.5 *Scorer validity*.

---

## 3. Problem Formulation & Metrics

Given a task $\tau \in \mathcal{T}$ with deterministic-plus-judge scoring $Q(\cdot) \in [0,1]$ and token consumption $C(\cdot)$, define on *paired runs* $(a_s, a_{T,p})$ where $a_s$ is the single-agent artifact and $a_{T,p}$ is the team artifact produced under assembly protocol $p$:

- **Capability Transfer Rate (CTR)**. Two variants for two baselines:
  $$
  \text{CTR}_{\text{naive}} = Q(a_{T,p}) / Q(a_s), \qquad
  \text{CTR}_{\text{matched}} = Q(a_{T,p}) / Q(a_{s^{(k)}})
  $$
  where $a_{s^{(k)}}$ is the *compute-matched* single artifact (k-round refine or best-of-k, same total LLM-call budget as team). We report CTR as the **geometric mean over paired runs** (ratio scale—arithmetic mean is biased) and 95% bootstrap CI via 2000 block-bootstrap replications per task.
- **Coordination Overhead (CO)** = $C(a_{T,p}) / C(a_s)$; **Token Ratio (TR)** is synonymous. Integrator assembly overhead *includes* the dedicated final LLM call.
- **Team Memory & Structure (TMS)** = $[\![\text{L1 structural coverage} = 1.0]\!] \wedge [\![\text{all L2 assertions pass}]\!]$. A single boolean, no partial credit.

Weights in $Q$: $Q = w_1 \cdot \text{L1} + w_2 \cdot \text{L2} + w_3 \cdot \text{L3}$ with $w_1=0.50, w_2=0.30, w_3=0.20$. When the L3 judge is disabled, we renormalize to $(w_1 \cdot \text{L1} + w_2 \cdot \text{L2}) / (w_1+w_2)$ rather than injecting a constant—this removes an additive bias that shrinks CTR toward 1 for all arms.

TMS is *consistently defined* across metric doc, scoring code, and paper text. ✓ (v0.5 had three competing definitions; see §7.)

---

## 4. Benchmark Design

### 4.1 Task space

5 workplace scenarios (DOCument writing, DATA aggregation, PROJect tracking, CROSS-functional coordination, CONTENT creation) × 3 coupling levels (LOW: parallel independent sub-tasks; MEDIUM: sequential dependencies; HIGH: parallel with cross-validation), yielding 15 task families. Each family is parameterized: inputs (e.g., team member records, table rows, conflict lists) are resampled and ground truths (L2 expected values, counts, sets) are deterministically recomputed. AC-4 verified per-family uniqueness of 10 variants and correctness of recomputed ground truths.

### 4.2 Controlled variables

**Assembly protocol.** Four protocols applied to the *same sequence of role outputs* $(r_1, \dots, r_k)$:

| Protocol | Def | LLM calls added | Mechanism |
|---|---|---|---|
| `last` | $a_T = r_k$ | 0 | v0.1 default. Most frameworks behave this way unless configured otherwise. |
| `concat` | $a_T = \bigoplus_i \text{role-name heading} + r_i$ | 0 | Deterministic concatenation with role-name boundaries. |
| `blackboard` | $a_T = \text{slot-schema merge}(\{r_i\}, \text{required\_sections})$ | 0 | Structured slot filling: each section body is populated from whichever role writes content whose heading matches that section; unmatched content is appended. Empty slots render as `（本节无内容）`—the behavior that exposed the scorer bug (§4.4). |
| `integrator` | $a_T = \text{LLM}(\{\text{role } i: r_i\}, \text{task desc + required sections})$ | **+1** | A dedicated LLM call merges all role outputs into a single document. Token cost of this call is *included* in CO. |

Figure 2 (to draw) illustrates all four protocols on a four-role content task.

**Compute-matched single baselines.**

- `single_refine_k`: k sequential self-revisions using the same prompt plus the previous output as attachment, where k equals the team size for the current task. Total LLM calls = k, matching the team.
- `single_bon_k`: k independent samples (varied seeds), then one selection LLM call that outputs `Best: N`. Total calls = k+1, typically 1 more than the team (we attribute this marginal cost to the team-favorable side).

### 4.3 Scoring protocol & the v2.2 measurement-integrity correction

L1, L2, L3 are defined in §3. Two corrections deserve explicit reporting because they materially changed measured effects.

**Correction 1 (L1 content-aware v2.1 → v2.2).** The v0 scorer checked only that required section headings existed. Under the `blackboard` protocol this made L1 trivially satisfiable: blackboard *mechanically writes every required section heading.* Over 45 pilot runs under blackboard we observed 41 runs with empty sections marked `（本节无内容）`, yet all received perfect L1 = 1.0 and therefore perfect Q, because 15/15 tasks lacked L2 assertions (see Correction 2). Scoring v2.2 adds a *content-presence* gate: a section is counted only if the heading matches AND the body (excluding placeholders) has ≥8 normalized characters. We additionally adopt standard markdown section semantics (sections extend until the next same- or higher-level heading or another matched required-section heading). Seven boundary cases (empty placeholders, subheading content, bold pseudo-headings, same-named sections, leading spaces, nested hierarchies) are verified with unit tests.

**Correction 2 (L2 assertion migration v0.1 → v2).** The original 15 tasks declared ground-truth fields under ad-hoc keys (`expected_total_qty`, `min_conflicts_identified`, …) that the v2 L2 rubric did not recognize; consequently L2 fell into the "no assertions" branch and returned 1.0 for every run, meaning Q was effectively a pure structure score. We migrated all 15 tasks and 150 parameterized variants to the shared `expected_sets / expected_values / expected_counts + answer_block_schema` schema, verified 15/15 tasks have at least one L2 assertion, and ran AC: for every task the correct answer achieves L2 ≥ 0.99, a deliberately incorrect answer scores strictly lower, and a missing answer block scores ≤ 0.01.

L2 uses set F1 for expected_sets, relative-error-with-tolerance for expected_values, and list-length ≥ threshold for expected_counts. All three are deterministic. L2 outputs a list-encoded `notes` field explaining any zero scores.

### 4.4 Runner, breakpoint-resume, and balance guard

The runner supports any combination of assembly protocol, single-baseline kind, and scoring-variant flags. Two reliability features were added for this campaign:

- **Breakpoint-resume.** Each run writes a per-(task,mode,seed) JSON file. A restart re-scans existing files and skips completed runs; summary and pairs CSVs are rebuilt deterministically. Zero extra LLM cost for restarts.
- **Balance guard.** For providers that expose a balance endpoint (DeepSeek), the runner queries balance every 5 runs and exits cleanly below a threshold (default ¥5), with a resume instruction printed to stderr. This matters because pilot campaigns run overnight.

---

## 5. Experiments

> **Data note.** All numbers below are **pilot v2 final**: DS v4 Flash, 15 tasks (with migrated L2 assertions) × 3 seeds × 7 arms = 315 runs, scoring v2.2, no L3 judge. An earlier v1 pilot (same matrix, L2 inactive) is used only for the scorer ablation in §5.3.
<!-- src: paper/experiments/v2/pilot_flash_v2/summary.csv + pairs.csv; report: pilot_v2_report.md -->

### 5.1 Main result: assembly protocol dominates CTR

**Table 1. Seven arms, pooled over 15 tasks × 3 seeds (n = 45 per arm).** DS v4 Flash, no L3 judge.
<!-- src: paper/experiments/v2/pilot_flash_v2/summary.csv 7-arms + pairs.csv -->

| Arm | Q_mean | L2_mean | TR (tokens vs single) | CTR_naive | CTR_matched (vs refine-k) |
|---|---|---|---|---|---|
| single (1-shot) | 0.606 | 0.759 | 1.00× | 1.00 | — |
| single_refine_k | 0.582 | 0.720 | **3.33×** | 0.96 | 1.00 (ref) |
| single_bon_k | 0.584 | 0.715 | **4.27×** | 0.96 | ~1.00 |
| team_last | 0.417 | 0.566 | 1.46× | **0.68** | **0.69** |
| team_concat | 0.535 | 0.536 | 1.42× | 0.89 | 0.91 |
| **team_integrator** | **0.881** | 0.741 | 2.14× | **1.52** | **1.55** |
| team_blackboard | 0.478 | 0.602 | 1.44× | 0.78 | 0.81 |

**Finding 1. Assembly protocol is the dominant factor—and the gap is enormous.** Geometric-mean CTR_matched across 4 team protocols spans **0.69 → 1.55 (Δ 0.86)** over *identical role outputs*. The integrator arm beats the compute-matched baseline with p = 2.1×10⁻⁷, Cliff's d = +0.74, bootstrap 95% CI [1.37, 1.76]; every mechanical protocol is significantly *worse* than even the 1-shot single (last d = −0.44, blackboard d = −0.28, concat d = −0.15). The default engineering choice of `last-role = team output` does not merely underperform—it produces a "team-inferiority" artifact (CTR 0.68) that flips sign under integrator assembly.

**Finding 2 (variance decomposition).** Over the same set of role outputs, the assembly protocol factor explains **40.0%** of artifact-quality variance (one-way ANOVA F = 39.1, p = 2.0×10⁻¹⁹, η² = 0.400), whereas the single-agent compute strategy (1-shot / refine-k / bon-k) explains **0.3%** (F = 0.2, p = 0.84, η² = 0.003). Assembly explains 130× more variance than compute.
<!-- src: stats_v2 one-way ANOVA on pilot_flash_v2 -->

**Finding 3. Team gains survive compute-matching.** Integrator burns 2.14× tokens vs the 1-shot single and reaches CTR_naive 1.52; both refine-k (3.33×) and bon-k (4.27×) burn *more* compute yet score *below* the 1-shot single (CTR_naive 0.96). Specialization plus semantic integration is not reducible to more sampling or more revision rounds.

**Finding 4. Mechanical assembly fails at the semantics step, and L2 localizes where.** Under migrated L2 assertions, concat's factual layer (L2 = 0.536) falls *below* last's (0.566): the answer-block extractor takes the last ```json block, which in a naive concatenation is the final role's *partial* block, while earlier roles' numeric content is stranded. The integrator is the only protocol that reliably aggregates all roles' numbers into one consistent answer block (45/45 runs contain a well-formed block). Mechanism case study (structure): on t-CONTENT-M-02, roles write headings like `## 主文案撰写员（main）— 交付物` rather than the schema-required `## 主文案+Slogan`; the blackboard's slot matcher routes these into `## 其他` and leaves required sections empty, L1 = 0.0.

### 5.2 CTR after controlling assembly, by coupling

**Table 2. Quality by coupling level (5 tasks × 3 seeds per cell).** <!-- src: pilot_flash_v2 coupling breakdown -->

| Coupling | single | refine-k | last | concat | **integrator** | blackboard | integrator CTR_matched |
|---|---|---|---|---|---|---|---|
| Low | 0.603 | 0.522 | 0.404 | 0.537 | **0.905** | 0.500 | **1.69** (p = 1.3×10⁻³) |
| Medium | 0.595 | 0.608 | 0.339 | 0.493 | **0.876** | 0.447 | **1.46** (p = 4.0×10⁻⁴) |
| High | 0.621 | 0.615 | 0.510 | 0.574 | **0.861** | 0.488 | **1.51** (p = 4.9×10⁻³) |

The integrator advantage is **uniform across coupling levels** (all three p < 0.005); no Simpson paradox emerges when pooling. Notably, v0.5's "coupling law" (CTR increasing monotonically with coupling) does **not** reappear once assembly is controlled—the Low-coupling cell posts the highest CTR_matched (1.69), driven by the refine-k baseline's relative weakness on low-coupling tasks (0.522). By scenario, CTR_matched ranks CROSS (1.69) > CONTENT (1.63) > PROJ (1.53) > DOC = DATA (1.46).

### 5.3 Scorer validity

We document two scorer ablations in place of a full human study (left for the full experiment).

- **L1 v0 (title-only) vs v2.2 (content-aware).** In the v1 pilot, blackboard mechanically rendered every required heading, 41/45 runs had empty sections (`（本节无内容）`), and all 45 received perfect L1 = 1.0—flipping the arm from "best" to "below average" once the content gate landed. This incident is itself evidence that automated structural rubrics without content gates are gameable by construction.
- **L2 off (v1) vs L2 on (v2), same task matrix.** Enabling L2 lowered every arm's absolute Q (single 0.692 → 0.606; integrator 0.958 → 0.881) but *increased* the integrator's relative advantage (CTR_matched 1.54 → 1.55; d +0.59 → +0.74): the numeric layer rewards exactly the cross-role aggregation that only the integrator performs, and punishes the stranded numeric content in mechanical concatenation (concat L2 0.536 < last 0.566). Findings F1–F4 are robust to the L2 switch—direction, significance, and effect ordering all preserved.

### 5.4 Statistical details

All directional claims use the one-sided Wilcoxon signed-rank test on paired per-(task,seed) differences. CTR CIs use 2000 block-bootstrap replications at the task level (task = block). For any multi-Finding table we will apply BH-FDR correction in the final version and mark each p accordingly.

---

## 6. Discussion

**For practitioners.** Decision table for "when to use a team and which assembly":

| Scenario / coupling | Recommendation | Why |
|---|---|---|
| Low coupling, small doc | Single + refine-3 (if you have budget) | Last-team is worse; integrator's overhead isn't justified. |
| Medium coupling | Team + integrator | CTR matched ≈ 1.5×; 2× token cost acceptable if time-to-quality matters. |
| High coupling (aggregation, cross-validation) | Team + integrator (mandatory) | Only integrator reliably assembles conflicting-source info into one coherent document. |

**For framework developers.** Expose assembly protocol as a first-class knob. Today, AutoGen (groupchat speaker-selection → reply content is last-speaker), CrewAI (sequential → last agent output unless explicitly wired), and LangGraph (edge endpoints) behave like the `last` arm unless the user patches in explicit aggregation. A built-in `team.finalize("integrator"|"concat"|"blackboard"|"last")` with token-cost attribution would align research and production practices.

**For benchmark designers.** Three lessons: (1) Report assembly protocol the same way you report temperature—it can swing the measured effect more than the model does. We suggest a minimal reporting checklist: assembly protocol (last/concat/integrator/blackboard/other + short text description); cost attribution for the assembly step (additional calls and tokens); role-output truncation policy applied *before* assembly vs at assembly. (2) Structural rubrics require a content gate. Mechanical headings are always a gaming risk when evaluation is automated. (3) Compute-matched baselines are not optional for "multi vs single" papers. Without them a critic can explain any result by "the team used more compute."

---

## 7. Limitations

1. **Monolingual, Chinese-heavy.** Task descriptions and role prompts are in Chinese; artifact rubrics check Chinese-section headings. We note this and defer a US/English subset to follow-up work.
2. **Synthetic office tasks.** While seeded from real documents (seed-01 weekly report, seed-02 risk alert, seed-03 cross-source check), they are still synthetic and do not measure ground-truth downstream outcomes.
3. **Fixed team topology.** We use serial handoff with the same role templates for all tasks; no self-organizing role discovery, no parallel tool usage, no agent churn.
4. **Model coverage in this draft.** Only one model family run so far (DS v4 Flash). Pilot v2 (same family, migrated tasks) and a Kimi K3 run are queued.
5. **L3 judge disabled in this draft.** Pilot v2 will enable L3 for a subsample to assess stability of arm ordering when semantic judgment is added; if the top/bottom two arms are preserved under L3 on, we use this as sufficiency argument for the full study.
6. **Open-loop runtime.** No mid-run budget halts, no human-in-the-loop interventions, no pause/resume. v0.5 §6's runtime-controllability discussion is retained as future work.
7. **TMS definition harmonization.** v0.5 had three inconsistent TMS meanings (section-only hit / section + numeric hit / team memory retention). v0.6 fixes a single definition in §3 and is checked in code.

---

## 8. Conclusion

The field has been asking "do LLM teams outperform individuals," but most of the variance in the answer comes from *how the team's output is assembled*, not from the model's capability or even the task's coupling. Our controlled experiment over four assembly protocols shows that the integrator protocol achieves a mean CTR_matched of 1.54 against a compute-matched self-revision baseline (p < 10⁻⁶, d +0.59) while naive last-role assembly, the default behavior of many frameworks, yields CTR_matched = 0.85. TeamBench provides the first reproducible testbed for disentangling these effects and will enable future work on topology, prompts, and cross-framework generalization without conflating them with a pipeline step that nobody had been measuring.

---

## Appendix A. Assets (must read before citing any number)

- Raw run-level JSONs: `paper/experiments/v2/pilot_flash/` (v1, scoring v2.2) and `paper/experiments/v2/pilot_flash_v2/` (v2, migrated L2).
- Summaries: `summary.jsonl`, `summary.csv`, `pairs.csv` inside each.
- Rescore tool: `paper/experiments/v2/rescore.py`. Deterministic; rerun to regenerate summaries from JSONs.
- Statistics: `paper/experiments/stats_v2.py` (bootstrap CTR, Wilcoxon, Cliff's d, BH-FDR).
- Assembly protocols: `paper/infra/assembly/protocols.py`.
- Scoring: `paper/metrics/scoring_v2.py` (v2.2, content-aware L1 + migrated L2).
- Migrations: `paper/tasks/migrate_assertions.py`.
