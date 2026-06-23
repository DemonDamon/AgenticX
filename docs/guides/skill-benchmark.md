# Skill benchmark.yaml

Optional regression cases for skill self-evolution (Hermes parity Phase 4).

Place at: `~/.agenticx/skills/<skill-name>/tests/benchmark.yaml`

```yaml
cases:
  - input: "Describe the scenario this skill should handle"
    expect_keywords:
      - "step"
      - "verify"
    expect_regex: "^## Procedure"
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `input` | No | Scenario hint; if set, must appear in candidate SKILL.md (case-insensitive) |
| `expect_keywords` | No | At least one keyword must appear in candidate SKILL.md |
| `expect_regex` | No | Regex must match candidate SKILL.md |

## Scoring (deterministic)

When GEPA generates multiple candidates, each is scored on:

- **accuracy** — keyword/regex hit rate on benchmark cases
- **brevity** — shorter vs base skill (when patching)
- **robustness** — hit rate with noisy suffix appended to inputs

Non-dominated candidates (Pareto front) are kept; others are discarded.

If no `benchmark.yaml` exists, all candidates pass through without pruning.
