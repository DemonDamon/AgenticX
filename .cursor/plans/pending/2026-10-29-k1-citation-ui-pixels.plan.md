# K1 citation UI pixels (P0 follow-up)

Plan-Id: 2026-10-29-k1-citation-ui-pixels
Branch: `feat/agx-rules-knowledge-p0-k1-citation-ui` (from `origin/main`)

## Goal

Ship React pixels that consume the K1-3 citation view-model
(`docs/agx-rules-knowledge-suite/citation-ui-contract.md` /
`agenticx.retrieval.citation_view.to_citation_view`) so portal (and admin if
trivial) can render citations / conflicts / missing for Brand-A fixtures.

## Scope

1. Shared TS types + Brand-A fixture matching the contract keys.
2. Shared `CitationEvidencePanel` React component (citations list, conflicts
   warning, missing soft hint) in `@agenticx/ui` so portal + admin both import it.
3. Portal demo mount: `/workspace/citations` with Brand-A seed view (no live
   retrieval required).
4. Vitest: fixture shape + panel pure helpers (or RTL smoke if already wired).
5. Optional HD shot `16-portal-citation-evidence.png` if portal login stays healthy.
6. Update citation-ui-contract consumer note that pixels landed.

Out of scope: wiring live `assemble_evidence` HTTP, A9, squash-merge, unrelated dirty.

## Acceptance

- [x] Brand-A-only ids in fixture / copy
- [x] Panel renders citations + conflicts + missing from fixture
- [x] Vitest green for types/fixture contract keys
- [x] PR open against main
