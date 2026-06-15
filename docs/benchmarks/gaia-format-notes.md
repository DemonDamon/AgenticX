# GAIA Format Notes (Frozen for Initial Integration)

## Scope

This document freezes the GAIA format assumptions used by AgenticX initial integration (`Plan-Id: 2026-06-15-gaia-benchmark-integration`).

## Dataset assumptions

- Primary source: `gaia-benchmark/GAIA` dataset on Hugging Face.
- Typical task columns:
  - `task_id`
  - `Question`
  - `Level`
  - `Final answer` (available for dev/public evaluation splits)
  - `file_name` (optional attachment name)
  - `file_path` (optional attachment path)
  - `Annotator Metadata` (optional structured metadata)
- Input files supported by this integration:
  - `.jsonl` (one task per line)
  - `.json` (list of objects, or object with a `data`/`tasks` list)
  - `.csv` (column headers must include `task_id` and question column)

## Submission assumptions

- Submission output format is JSON Lines (`.jsonl`).
- Required fields per line:
  - `task_id` (string)
  - `model_answer` (string)
- Optional field:
  - `reasoning_trace` (string)

Example:

```jsonl
{"task_id":"task-1","model_answer":"42","reasoning_trace":"..."}
{"task_id":"task-2","model_answer":"tokyo"}
```

## Prompting conventions

The GAIA leaderboard documentation asks systems to end responses with:

`FINAL ANSWER: [YOUR FINAL ANSWER]`

This integration includes a normalizer that extracts the final answer from that suffix when present, and falls back to full output text if missing.

## Run constraints for v1

- The pipeline does not upload results automatically.
- It produces:
  - a detailed run file (`results.jsonl`)
  - a leaderboard-ready file (`submission.jsonl`)
  - a run manifest (`manifest.json`)
- Resume mode is idempotent by `task_id`.

## References

- https://huggingface.co/datasets/gaia-benchmark/GAIA
- https://huggingface.co/spaces/gaia-benchmark/leaderboard/blob/main/content.py
