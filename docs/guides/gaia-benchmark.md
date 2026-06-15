# GAIA Benchmark Guide

This guide explains how to run GAIA benchmark integration in AgenticX and produce leaderboard submission files.

## 1) Prepare data

- Download GAIA metadata file (jsonl/json/csv) to local path.
- Ensure each row contains:
  - `task_id`
  - `Question`
- Optional but recommended:
  - `Level`
  - `Final answer` (for local accuracy checks)
  - `file_name` / `file_path`

## 2) Run benchmark

From repo root:

```bash
python scripts/run_gaia_benchmark.py \
  --dataset-path /absolute/path/to/metadata.jsonl \
  --output-dir artifacts/gaia/run1 \
  --benchmark-name gaia_run1 \
  --export-submission
```

Common options:

- `--limit 20`: run only first N valid rows.
- `--offset 100`: skip first N rows.
- `--resume`: skip task IDs already present in `results.jsonl`.
- `--force-rerun`: ignore previous results even in resume workflows.
- `--timeout 60`: timeout per task (seconds).

## 3) Validate submission format

```bash
python scripts/run_gaia_benchmark.py \
  --validate-only \
  --output-dir artifacts/gaia/run1
```

Or validate a custom file path:

```bash
python scripts/run_gaia_benchmark.py \
  --validate-only \
  --submission-file /absolute/path/to/submission.jsonl
```

## 4) Output files

Each run creates:

- `results.jsonl`: per-task detailed rows (raw output, normalized answer, success, error).
- `submission.jsonl`: leaderboard-oriented rows (`task_id`, `model_answer`, optional `reasoning_trace`).
- `manifest.json`: reproducibility metadata (params, commit, counts, validation errors).

## 5) Troubleshooting

- `No valid GAIA tasks loaded`
  - Check input file format and required fields.
- `duplicate task_id`
  - Deduplicate dataset before running.
- `submission invalid`
  - Inspect validator errors for exact line and field.
- Missing attachment references
  - Provide `--dataset-root` so relative `file_path` can be resolved.
