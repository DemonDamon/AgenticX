---
name: code-deep-research
description: Use when deeply researching an open-source GitHub repository for AgenticX adoption, selective mechanism internalization, gap analysis, or an evidence-backed implementation proposal.
---

# Code Deep Research

## Overview

Research an upstream repository from a locked commit, compare it with verified AgenticX code, and make an evidence-backed adoption decision. The local upstream clone is the source of truth; MCP tools accelerate discovery but never replace source verification.

## When to Use

Use for:
- `/codedeepresearch` requests.
- “调研这个 GitHub 项目能否集成进 AgenticX”。
- Comparing an upstream framework, SDK, agent runtime, tool, memory, planner, UI, or protocol with AgenticX.
- Producing `ADOPT`, `SELECTIVE_ADOPT`, or `DO_NOT_ADOPT` recommendations.

Do not use for:
- Implementing an already-approved plan.
- General web research without a required GitHub repository.
- A quick API lookup or a review of one known source file.

## Required References

Before taking research actions:

1. Read [WORKFLOW.md](WORKFLOW.md) completely.
2. Copy its S0–S8 status ledger into `research/codedeepresearch/<repo_name>/meta.md`.
3. Read [TEMPLATES.md](TEMPLATES.md) before creating research artifacts.

Do not infer the workflow from this summary alone.

## Non-Negotiable Rules

- Clone the repository into `research/codedeepresearch/<repo_name>/upstream/` and lock its SHA.
- A failed clone blocks normal research. Do not emit Gap, Proposal, P0/P1, or an adoption verdict.
- Verify implementation claims against local source using `SHA + path + line range + symbol`.
- DeepWiki, GitHub MCP, and ZRead are optional accelerators. Discover their schemas before use; failure must follow the documented fallback.
- ZRead quota failure never makes a successful local-source study “incomplete”.
- Do not modify AgenticX production code during research.
- Do not invent benchmarks, user needs, issue numbers, runtime validation, or repository behavior.
- Do not create an implementation plan or code task unless the user separately requests implementation.

## Decision Rule

Determine Gap priority first, then derive the verdict:

- `ADOPT`: at least one valid P0.
- `SELECTIVE_ADOPT`: no P0, but at least one evidence-backed P1 with a real user problem.
- `DO_NOT_ADOPT`: only P2/NO-GAP, unvalidated demand, or insufficient value.

Do not promote a Gap to force a desired verdict.

## Completion Rule

Only claim completion when S0–S7 are completed or legitimately skipped, all quality gates in WORKFLOW pass, and S8 is then marked complete. Final chat output must lead with the verdict and link the written artifacts.

## Common Failures

- Starting with DeepWiki instead of locking the upstream SHA.
- Treating README or MCP-generated code as implementation evidence.
- Reading only upstream code and assuming AgenticX lacks the capability.
- Turning every upstream feature into a P0.
- Forcing PoC/MVP sections when the correct verdict is `DO_NOT_ADOPT`.
- Leaving stale evidence from an older upstream SHA in current artifacts.
