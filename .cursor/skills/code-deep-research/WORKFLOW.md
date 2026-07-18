# Code Deep Research Workflow

Follow this document in order. Update `meta.md` after every stage.

## Status semantics

- `[ ]` pending; forbidden at final delivery.
- `[x]` completed with evidence/artifact.
- `[-]` not applicable or skipped; append the reason.
- `[!]` blocked; stop all dependent stages and report.

```markdown
## Research Status
- [ ] S0 Scope, workspace, and tool availability confirmed
- [ ] S1 Upstream cloned and commit SHA locked
- [ ] S2 Relevant AgenticX baseline verified
- [ ] S3 Upstream execution path verified from local source
- [ ] S4 Applicable DeepWiki and extra URL sources processed
- [ ] S5 Candidate claims cross-checked against source
- [ ] S6 Gap analysis and verdict derived
- [ ] S7 Proposal and evaluation gates written
- [ ] S8 Final quality gates passed
```

S8 is marked only after checking S0–S7; it is not an input to its own gate.

## S0 — Scope, workspace, tools

Parse the GitHub URL and optional extra URLs. Normalize `repo_name` from the last URL segment: remove `/` and `.git`; preserve case; replace characters outside letters, digits, `.`, `_`, `-` with `-`.

If absent, use these defaults and record them under `Assumptions`:

- Research only; no AgenticX implementation.
- Prefer zero new dependencies.
- Maintainability/control and regression safety outrank latency/cost.
- Analyze only modules relevant to the user’s stated goal.

Ask one focused question only when a missing choice changes product direction, allowed dependencies, or research scope.

Confirm the workspace contains `agenticx/`. Create the research directory and `meta.md`.

Discover MCP server/tool schemas before calling them:

- DeepWiki: architecture and design reasoning.
- GitHub MCP: issues, PRs, commits, remote file samples.
- ZRead: optional tree/read/search acceleration.

If discovery is unavailable, mark that MCP unavailable rather than guessing names. Retry a failed MCP category at most once with corrected parameters. Never use write-side GitHub tools.

## S1 — Lock upstream source

Target: `research/codedeepresearch/<repo_name>/upstream/`.

- New clone: use shallow clone and record remote, branch/tag, SHA, license, languages, monorepo status.
- Existing clone: verify remote, SHA, and clean status. Reuse a clean matching clone without pulling.
- Wrong remote or local modifications: mark blocked and ask the user; never reset, clean, or overwrite.
- Clone failure: mark S1 `[!]`, stop normal SOP, and emit no Gap/Proposal/verdict.

Existing research artifacts:

- Same SHA: update in place and preserve Evidence IDs.
- Different SHA: archive old Markdown under `archive/<old-sha>/` before writing current evidence. Ask first if moving may affect uncommitted work.
- Unknown prior SHA: stop before overwriting.

## S2 — Verify AgenticX baseline

Read `conclusions/README.md` when present, select only conclusions relevant to the user goal, then inspect their referenced implementation.

Minimum evidence:

1. Relevant conclusion/documentation.
2. Corresponding implementation file and symbol.

Create an `AgenticX Evidence` table in the Gap report: capability, path, symbol, current behavior. Record searched paths and search terms. State only “not found in the explicitly checked scope”, never “does not exist anywhere”.

Compare 12-Factor Agents, Unified Tool V2, Compiled Context, Hooks/Flow, or other advanced capabilities only when they share responsibility with the upstream mechanism.

## S3 — Verify upstream source

Use local Read/Glob/Grep as the primary path. Shell is for git, isolated setup, examples, and tests—not generic file reading.

Read at least six evidence categories:

1. Public entry/API.
2. Core abstraction.
3. Main execution-path implementation.
4. Error/fallback handling.
5. Extension point.
6. Relevant test or example.

For every candidate mechanism locate, or explicitly report not found:

- API/config entry.
- Core execution function.
- State/data model.
- Failure handling.
- Test/example.

Runtime validation:

- Do not install global dependencies, run arbitrary installer scripts, use sudo, or initialize paid/destructive services without user approval.
- Approved setup must stay inside `upstream/` using an isolated environment.
- Default maximum for one first run is five minutes.
- If credentials/services are unavailable, use static verification and record `runtime_validation = static_only` or `blocked_or_timeout`.

Create:

- `<repo_name>_source_notes.md`
- `<repo_name>_code_index.md`

Every decision-relevant claim needs an Evidence ID:

```markdown
| Evidence ID | Claim | Source type | Exact location | SHA/number | Confidence |
|-------------|-------|-------------|----------------|------------|------------|
| E-001 | ... | local-source | SHA + path:lines + symbol | ... | high |
```

Confidence:

- `high`: locked local source proves implementation. Issue/PR may be high only for maintainer intent/history.
- `medium`: official docs plus partial local support.
- `low`: DeepWiki/blog/inference without direct implementation proof.

Implementation P0/P1 claims require `local-source high`.

The code index must include tool availability, a 2–3-level core tree, actual files read, key symbols with line ranges, search terms, and high-signal Issue/PR entries when available.

## S4 — Process external sources

DeepWiki, when available: ask one question for each topic:

1. Architecture/data flow.
2. Extension mechanisms.
3. Reliability.
4. Performance/cost.
5. Design trade-offs/limitations.
6. AgenticX fit.

Ask follow-ups only for contradictions or critical gaps. For each answer mark `verified`, `partially_verified`, or `unverified` and attach Evidence IDs. Unverified claims cannot enter P0/P1.

For each extra URL, save Markdown under `sources/` with author/organization, evidence quality, and consistency with locked source. Record each source status in `meta.md`. If no source applies, mark S4 `[-]` with reason.

## S5 — Cross-check

In source notes, create a table:

```markdown
| Claim | Evidence | Result (yes/no/partial) | Corrected wording |
|-------|----------|-------------------------|-------------------|
```

Cover every candidate mechanism, not only easy claims. Conflict precedence:

`locked local source > same-SHA official Issue/PR > official docs > DeepWiki > third-party article`.

Issues/PRs prove intent/history, not current implementation. With no external sources, still review every candidate claim and mark S5 `[x]` with `local-only; no external claims`.

## S6 — Gap analysis and verdict

Use the Gap template from TEMPLATES.md for every candidate.

`User problem` must come from user words, an AgenticX issue/failure, an existing requirement, or a reproducible experiment. Otherwise write `unvalidated hypothesis`; priority cannot exceed P2.

P0 requires all:

- Real user problem.
- `local-source high` upstream evidence.
- Code-level AgenticX gap in checked scope.
- A two-week verifiable closure path.

Derive verdict mechanically:

- Any valid P0 → `ADOPT`.
- No P0 but at least one evidence-backed, user-validated P1 → `SELECTIVE_ADOPT`.
- Only P2/NO-GAP or unvalidated value → `DO_NOT_ADOPT`.

## S7 — Proposal and next steps

Use exactly one Proposal template from TEMPLATES.md.

- `ADOPT` / `SELECTIVE_ADOPT`: implementation-oriented template with required evaluation section.
- `DO_NOT_ADOPT`: non-adoption template; do not invent PoC/MVP work.

Do not create `.cursor/plans/` documents or implementation tasks unless the user separately requests implementation.

Write “下一步规划调整” as the final Proposal section and summarize it in the final response.

## S8 — Quality gate

All must pass:

- `upstream/` exists; `meta.md` has locked SHA.
- S0–S7 are `[x]` or legitimate `[-]`; none are `[ ]` or `[!]`.
- All six source evidence categories were inspected.
- Evidence IDs resolve from Gap/Proposal to exact source locations.
- Code index records local/GitHub/ZRead provenance.
- Every candidate is cross-checked.
- AgenticX checked paths/search terms are recorded.
- Each P0/P1 has Gap ID, acceptance evidence, and scope boundary.
- Verdict matches Gap priorities.
- Unrun examples, missing Issues/PRs, and unverified mechanisms are explicit.
- ZRead failure is not treated as source-study incompleteness.

Fix failures before claiming completion, then mark S8 `[x]`.
