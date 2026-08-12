# Contributing to AgenticX

Thank you for contributing. Please read this guide before opening a Pull Request.

Chinese version: [CONTRIBUTING_ZN.md](CONTRIBUTING_ZN.md)

---

## What we expect

AgenticX is a multi-agent framework with a local Studio API (`agx serve`), a Desktop app, and an optional Enterprise stack. Contributions should:

1. **Stay in scope** — change only what the issue/PR requires. No drive-by refactors of unrelated code.
2. **Be verifiable** — include or update tests when behavior changes; say how you validated the change.
3. **Be safe to merge** — no secrets, no customer-identifying data, no hardcoded internal endpoints.

Every change should be traceable to a concrete bug, feature request, or documented requirement.

---

## Branch naming

All changes go through a feature branch + Pull Request. Do not push directly to `main`.

| Scenario | Prefix |
|----------|--------|
| New feature | `feat/<name>` |
| Bug fix | `fix/<name>` |
| Documentation | `docs/<name>` |
| Refactor | `refactor/<name>` |
| Tests | `test/<name>` |

```bash
git checkout -b feat/my-feature
# ... develop, commit ...
# Open a PR into main
```

---

## Development setup

**Python 3.10+** required.

```bash
git clone https://github.com/DemonDamon/AgenticX.git
cd AgenticX

# Recommended
pip install uv
uv pip install -e ".[dev]"

# Or
pip install -e ".[dev]"
```

Add optional extras only if your change needs them (see `README.md` / `pyproject.toml`):

```bash
uv pip install -e ".[memory,mcp]"
# or
uv pip install -e ".[all]"
```

System / document tooling details: [INSTALL.md](INSTALL.md).

### Desktop (when touching `desktop/`)

```bash
cd desktop
npm install
npm run dev          # Vite default port 5713 (override with AGX_DEV_PORT)
npm run build        # must pass before PR if UI/Electron code changed
```

Notes:

- Desktop talks to a **local** `agx serve` process (not a remote backend by default).
- After changing Electron main-process code (`desktop/electron/`), fully restart the app (`⌘Q` / stop `npm run dev`); renderer reload alone is not enough.
- `node-pty` may need `npx @electron/rebuild -f -w node-pty` after Electron upgrades.

### Runtime config (local)

User/runtime data lives under `~/.agenticx/` (e.g. `config.yaml`, sessions, workspace). Do not assume editing the repo alone changes a running Desktop install’s config.

---

## Tests

### Python (required for backend / runtime changes)

The bar is **"no new failures"**, not "the whole suite is green".

`tests/` currently holds ~450 files, and some of them fail on a clean `main` checkout or need credentials / network / external CLIs. Running everything is slow and will show pre-existing red. So:

1. Identify the test files covering your change and run them **before** your edit to record the baseline.
2. Run them again after your edit and confirm you introduced no new failures.
3. Report both results in the PR (e.g. "`test_studio_server.py`: 4 failed / 27 passed before and after — same 4 pre-existing failures").

```bash
# Targeted run; -o addopts= skips the default coverage flags for a faster loop
python -m pytest tests/test_agent_runtime_tool_search.py -q -o addopts=

# Skip slow tests when running a wider selection
python -m pytest tests/ -q -o addopts= -m "not slow"
```

New behavior should come with a unit or smoke test under `tests/` (many existing files use the `test_smoke_*.py` naming pattern).

> No CI job runs the Python suite — this check is on you as the contributor, so please state what you ran.

### Desktop

If you change TypeScript/React/Electron under `desktop/`:

```bash
cd desktop
npm run build                      # required
npm run test:action-confirmation   # if related
npm run test:native-connectors     # if related
```

### Studio smoke (required if you edit `agenticx/studio/server.py`)

`create_studio_app()` and its import block are sensitive. After any edit to that file:

1. Start a fresh server on a free port, e.g.  
   `agx serve --host 127.0.0.1 --port 18765`
2. Confirm the process stays up and core routes return 200, for example:  
   `/api/session`, `/api/avatars`, `/api/sessions`
3. When editing imports or large blocks: **add/remove only the intended lines** — do not replace whole adjacent import sections (easy to drop a critical import and break Desktop empty-state).

---

## Continuous integration

CI on a PR is about packaging and secret hygiene, not correctness:

| Workflow | What it does |
|----------|--------------|
| `.github/workflows/security-scan.yml` | Runs gitleaks over the **full git history** on every PR, plus an enterprise dependency audit |
| `.github/workflows/build-desktop.yml` | Builds the Desktop app (macOS DMG / Windows installer) |
| `.github/workflows/enterprise-db-compat.yml` | Enterprise database compatibility checks |

Two consequences:

- A credential committed at **any** point in your branch history will fail the scan, even if a later commit removes it. Rewrite the branch rather than layering a "remove key" commit on top.
- Nothing in CI runs the Python test suite, so test evidence in the PR description matters.

---

## Repository map (where to change what)

| Area | Path | Notes |
|------|------|--------|
| Core framework / runtime | `agenticx/` | Agents, tools, memory, LLM providers |
| Local API (Studio) | `agenticx/studio/` | REST + SSE; no built-in web UI |
| Desktop app | `desktop/` | React + Electron + Vite |
| Tests | `tests/` | Prefer smoke/unit next to the feature |
| Packaging | `packaging/` | PyInstaller / sidecars |
| Enterprise | `enterprise/` | **Not open to external PRs** — see below |

If the target surface is unclear (Desktop vs Studio), ask in the issue before coding.

### Enterprise (`enterprise/`)

The Enterprise stack (gateway, admin console, web portal) is **not currently accepting external Pull Requests**. It carries deployment-specific assumptions and delivery constraints that are hard to review from outside.

If you found a bug there or want a change, please **open an Issue first** and we will take it from there. PRs that modify `enterprise/` without a prior agreed Issue will be closed without review.

---

## Code conventions

- **Scope discipline**: only touch paths required by the PR. Do not “improve” unrelated working logic.
- **Match existing style** in the file you edit (imports, naming, patterns).
- **Do not** add comments, type annotations, or docstrings on code you did not change.
- **Do not** add abstractions or config knobs for hypothetical future needs.
- Prefer small, reviewable PRs over multi-concern megapatches.
- New dependencies: update `pyproject.toml` (Python) or `desktop/package.json` (Desktop) and justify in the PR.
- UI changes should follow existing theme tokens and patterns in `desktop/` (avoid one-off colors / ad-hoc components when a shared primitive exists).

---

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(studio): return session_id before MCP auto-connect finishes
fix(desktop): keep pane model selection isolated across panes
docs: clarify agx serve local-only Desktop binding
test(runtime): add smoke for tool-round limit signaling
```

Guidelines:

- Subject focuses on **why / user-visible effect**, not a file dump.
- Do **not** put secrets, customer names, or internal deployment paths in commits or PR text.
- Do **not** phrase commits/PRs as “align with &lt;third-party product&gt;” — describe AgenticX behavior in product-neutral terms.
- Avoid AI tool attribution trailers (`Co-authored-by: Cursor`, etc.) unless a maintainer asks for a specific format.

Maintainers may add additional trailers when merging (plan / process metadata). Contributors do not need to invent those.

---

## Pull requests

- Link the related Issue (or describe the bug/feature clearly).
- Summarize **what** changed and **how you tested**.
- Keep the PR limited to one concern when possible.
- Update docs when user-facing behavior or CLI flags change.
- Expect review feedback focused on scope, correctness, and regressions.

### Pre-PR checklist

- [ ] Branch is not `main`; PR targets `main`
- [ ] Change set is scoped to the stated requirement
- [ ] Relevant tests run before/after with **no new failures**, and the result is stated in the PR
- [ ] Desktop `npm run build` passes if `desktop/` changed
- [ ] If `agenticx/studio/server.py` changed: cold-start smoke of `agx serve` done
- [ ] `enterprise/` untouched (or a maintainer already agreed in an Issue)
- [ ] No API keys, tokens, credentials, or customer-identifying data anywhere in the branch history
- [ ] New files checked for sensitive content
- [ ] Dependencies updated in the appropriate manifest when added
- [ ] New behavior has tests (or a clear reason why not)
- [ ] Commit messages follow Conventional Commits

---

## Reporting bugs

Open a GitHub Issue with:

- What you expected vs what happened
- Steps to reproduce
- AgenticX / Desktop version (or git SHA), OS, Python version
- Relevant logs (redact secrets). For Studio/Desktop empty-state issues, note whether `agx serve` is listening (see `~/.agenticx/serve.port` when using Desktop)

---

## Licensing

AgenticX is released under the [Apache License 2.0](LICENSE). By submitting a contribution you agree that it is licensed under those same terms, and you confirm you have the right to submit it (it is your own work, or you are authorized to contribute it).

---

## Questions

- Product site: [https://www.agxbuilder.com/](https://www.agxbuilder.com/)
- Prefer GitHub Issues for design discussion that should stay attached to a change

Thank you for helping improve AgenticX.
