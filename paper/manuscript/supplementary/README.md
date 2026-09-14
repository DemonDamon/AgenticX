# TeamBench — Supplementary Material (Anonymous Submission)

This archive contains the complete, runnable TeamBench benchmark referenced in the paper
"TeamBench: Assembly Protocol, Not Model Capability, Determines Whether LLM Agent Teams Pay Off".

## Contents

```
tasks/                    Task suite: 15 task families + 150 parameterized variants
  data/v0.1/              15 base task JSON files (5 scenarios × 3 coupling levels)
  data/generated/         150 parameterized variants (10 per family)
  task_generator.py       Parameterized variant generator (resampling + ground-truth recomputation)
  migrate_assertions.py   v0.1 -> v2 assertion schema migration (expected_sets/values/counts)
  validate_variants.py    Variant uniqueness + ground-truth validation
infra/                    Experiment runner
  teambench_runner.py     7-arm runner: single / refine-k / best-of-k / 4 assembly protocols
  assembly/               Assembly protocol implementations (last / concat / blackboard / integrator)
  single_baselines.py     Compute-matched single-agent baselines
metrics/                  Artifact scoring protocol (v2.2)
  scoring_v2.py           L1 (content-aware structural) + L2 (factual assertions)
  llm_judge.py            L3 semantic judge
analysis/                 Statistical analysis and experiment data
  stats_v2.py             Wilcoxon signed-rank, geometric-mean CTR, log-domain bootstrap, Cliff's delta
  rescore.py              Deterministic offline re-scoring
  judge_ablation_v2.py    L3 on/off ablation with cross-family judge matrix
  data/pilot_flash_v2/    DS v4 Flash: 315 runs (summary.jsonl, pairs.csv)
  data/pilot_kimi_k3/     Kimi K3: 315 runs (summary.jsonl, pairs.csv, meta.json)
  data/judge_v2_results.jsonl   L3 ablation judge outputs (420 judgments)
```

## Requirements

Python 3.11+. No exotic dependencies; the runner needs only `requests`; analysis needs
`numpy`/`scipy`. API keys are read from environment variables (`DEEPSEEK_API_KEY`,
`MOONSHOT_API_KEY`) and are never stored in the repository.

## Reproducing the main table

```bash
# 1. Generate the 150 variants (deterministic given seed)
python tasks/task_generator.py

# 2. Run the 7 arms x 15 tasks x 3 seeds (Flash example)
python infra/teambench_runner.py --model flash --arms all --tasks tasks/data/generated/ --seeds 0,1,2

# 3. Score offline (deterministic) and compute statistics
python analysis/rescore.py
python analysis/stats_v2.py
```

The runner supports breakpoint-resume (completed runs are skipped on restart) and a balance
guard (clean exit below a configurable provider-balance threshold).

## Scoring protocol integrity

The scoring code documents two measurement-integrity corrections described in the paper
(Sec. 4.3): the L1 content-presence gate (v2.1 -> v2.2) and the L2 assertion migration
(v0.1 -> v2). Both corrections and the motivating gaming incident are documented inline
in `metrics/scoring_v2.py` and reproducible via `analysis/rescore.py` over the released
run data.

## Data files

`summary.jsonl` contains one record per run: task id, arm, seed, per-layer scores
(L1/L2/L3), aggregate quality Q, token usage, and (for team arms) the assembly protocol.
`pairs.csv` contains the paired per-(task, seed) records used by `stats_v2.py` to compute
CTR, CIs, and significance tests. Raw role outputs are omitted for size; the scoring
layers are fully recomputable from the released fields.

## License

Code: MIT. Tasks and data: CC-BY-4.0.
