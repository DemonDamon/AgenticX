---
name: requirement-decompose
description: Decompose customer RFP materials into pages, interactions, and acceptance criteria for Near delivery loop.
metadata:
  author: AgenticX
  version: "1.0.0"
---

# Requirement Decompose

## When to use

Customer uploaded Word/PDF/MD materials need structured breakdown before design or development.

## Output contract

Write `output/<task_id>/requirement-breakdown.md` with sections:

1. **Source materials** — list absolute paths ingested
2. **Functional pages** — numbered routes/components
3. **Interactions** — primary user flows
4. **Acceptance criteria** — checkbox list, testable
5. **Out of scope** — explicit non-goals
6. **Reuse hints** — components/skills from AgenticX core worth reusing

## Process

1. Run `knowledge_search` if KB auto-retrieval is enabled
2. Cross-check against `sample-rfp.md` patterns for enterprise portal POCs
3. Keep MVP scope minimal — flag anything needing customer sign-off

## Quality bar

- Every acceptance item maps to at least one page or flow
- No placeholder "TBD" in acceptance section
