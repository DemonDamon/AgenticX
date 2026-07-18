# Code Deep Research Templates

Use these structures exactly. Omit only fields explicitly marked optional.

## Required artifacts

```text
research/codedeepresearch/<repo_name>/
├── meta.md
├── upstream/
├── <repo_name>_source_notes.md
├── <repo_name>_code_index.md
├── <repo_name>_deepwiki.md              # only when DeepWiki is available
├── <repo_name>_agenticx_gap_analysis.md
├── <repo_name>_proposal.md
├── <repo_name>_eval_plan.md             # optional; Proposal evaluation remains required
└── sources/                              # only when extra URLs are provided
```

## meta.md

```markdown
# <repo_name> Research Meta

## Research Status
<copy S0–S8 ledger from WORKFLOW.md>

## Scope
- User goal:
- Requested depth:
- Constraints:
- Priority:

## Assumptions
- ...

## Upstream
- URL:
- Branch/tag:
- Locked SHA:
- License:
- Main languages:
- Monorepo: yes/no
- Runtime validation: executed/static_only/blocked_or_timeout

## Tool Availability
- DeepWiki: available/skipped/failed — reason
- GitHub MCP: available/skipped/failed — reason
- ZRead: available/skipped/failed — reason
- MCP assist: full/partial/none

## External Source Status
- DeepWiki: completed/skipped/failed
- <extra URL>: completed/skipped/failed
```

## Source notes

```markdown
# <repo_name> Source Notes

## Problem and boundaries
### Solves
### Does not solve

## Runtime validation
- Command:
- Result/exit code:
- If not run, reason:

## Core abstractions
| Name | Responsibility | Exact source location |

## Main execution path
<Mermaid when a flow/sequence materially clarifies the path>

## Failure and fallback behavior
| Failure | Handling | Evidence ID |

## Extension points
| Extension | Contract | Evidence ID |

## Evidence
| Evidence ID | Claim | Source type | Exact location | SHA/number | Confidence |

## Cross-check
| Claim | Evidence | Result (yes/no/partial) | Corrected wording |
```

## Code index

```markdown
# <repo_name> Code Index

## Provenance
- local clone SHA:
- GitHub MCP:
- ZRead:

## Core tree
<2–3 levels; mark key packages>

## Files actually read
| File | Evidence category | Symbols inspected |

## Key symbols
| Symbol | SHA + path:line-range | Responsibility |

## Search coverage
- Paths:
- Exact symbols:
- Synonyms:
- Protocol/config fields:

## High-signal Issue/PR history
- #<number> <title> — <one-sentence relevance> — <URL>
<!-- Write “not retrieved” when unavailable. -->
```

## AgenticX evidence

Place near the start of the Gap report:

```markdown
## AgenticX Evidence
| Capability | Path | Symbol | Current behavior |

## Checked scope
- Paths:
- Search terms:
- Scope limitation: conclusions apply only to the checked scope.
```

## Gap

```markdown
### G-001 <name>
- User problem: <evidence-backed problem or “unvalidated hypothesis”>
- Upstream evidence: E-xxx
- AgenticX current state: <path + symbol + behavior>
- Actual gap: <specific missing behavior or NO-GAP>
- Value: high/medium/low
- Cost: high/medium/low
- Regression risk: high/medium/low
- Decision: P0/P1/P2/NO-GAP
- Minimal adoption: <smallest mechanism or “no implementation”>
- Scope boundary: <explicitly excluded adjacent work>
- Acceptance evidence: <test, assertion, reproduction, or metric>
```

## Proposal decision header

```markdown
## Decision
- Verdict: ADOPT | SELECTIVE_ADOPT | DO_NOT_ADOPT
- Why:
  - <Evidence ID / Gap ID + reason; max 3>
- Now: <single 1–2 week action, or “none”>
- Later: <P1/P2 or empty>
- Explicitly not doing:
  - ...
```

## Proposal A — ADOPT / SELECTIVE_ADOPT

```markdown
# <repo_name> AgenticX Proposal

<Decision header>

## 1. Background and boundaries
## 2. Verified upstream mechanisms
## 3. Minimal transferable principles and invariants
## 4. AgenticX design
### API/SDK contract
### Modules and data flow
### Algorithms/policies
### Errors and observability
## 5. Integration phases: PoC → MVP → stabilization
## 6. Evaluation: tasks, metrics, regression gates
## 7. Risks and rollback
## 8. 下一步规划调整
```

Every implementation item must cite one Gap ID. `SELECTIVE_ADOPT` must list upstream modules intentionally excluded.

## Proposal B — DO_NOT_ADOPT

```markdown
# <repo_name> AgenticX Research Decision

<Decision header>

## 1. Background and research boundary
## 2. Reusable upstream knowledge
## 3. AgenticX capability and NO-GAP/P2 findings
## 4. Why not adopt: value, cost, regression risk
## 5. Explicit exclusions: not entering implementation queue
## 6. Re-evaluation triggers
## 7. 下一步规划调整
```

Do not add PoC/MVP phases to Proposal B.

## Final response

```markdown
结论：<ADOPT / SELECTIVE_ADOPT / DO_NOT_ADOPT + one sentence>

- 关键依据：<Evidence/Gap>
- 当前动作：<one action or “归档研究，不进入实施队列”>
- 主要产物：<paths>
- 未验证项：<none or concise list>
```
