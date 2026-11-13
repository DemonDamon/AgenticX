# http-error-evidence

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

Baseline: a680b0663fe4f1ecf1afe5c4ac52b124df57a5b6.

## Evidence and changes
`agenticx/llms/provider_fault.py::classify_provider_fault` matches raw 402/429 substrings; `agenticx/runtime/llm_retry.py::_classify_error` matches raw 429/50x. URL ports and request identifiers can therefore trigger provider exclusion or retries.
FR1: Add `agenticx/llms/http_status.py` with bounded, cycle-safe exception-chain traversal (original_exception, explicit cause, otherwise unsuppressed context), URL-stripped messages and `http_status_code()`. Inspect all structured status_code/response.status_code values before matching explicit HTTP/status/error/code prefixes or leading three-digit status. Respect `raise ... from None`.
FR2: Both consumers use the same status evidence; keep their separate category/policy semantics. Provider transport errors become transient without hard blacklisting. Retry classifiers retain semantic phrases but no numeric substring patterns.
AC: `tests/test_http_status.py`, `tests/test_llm_retry.py`, and existing provider smoke tests cover URL/trace pollution, true 401/402/403/429/5xx, response attributes, explicit cause, suppressed context, cycles, and retry call counts. Run these through pytest.
Out of scope: SDK dependency updates, provider routing policy, streaming retry lifecycle.

## Validation
`PYTHONPATH=. python -m pytest -o addopts='' tests/test_http_status.py tests/test_llm_retry.py tests/test_smoke_anthropics-claude-code_provider_fault.py -q`: 53 passed. `git diff --check`: clean. Coverage addopts were disabled because the verification environment lacks pytest-cov; assertions ran normally.

## Remote regression acceptance
Add `.github/workflows/python-regressions.yml` for Python 3.12 with path-filtered pull requests to every base branch and main/master pushes. Install the current branch requirements.lock without upgrading locked packages; use pinned compatible test tools. `scripts/ci/python-regressions.py` prints the branch-local test selection, runs existing fault/retry/tool-argument/SDK/parser/crypto contracts, and selects only the optional-tool dispatch case from the broad runtime file. Missing contribution-specific files are explicitly listed, while missing document/crypto modules or skipped selected cases fail the job. Disable remote model metadata and model-weight downloads. Preserve strict pytest configuration checks; omit coverage collection to keep this bounded acceptance job inexpensive. Widen the existing security workflow's pull-request trigger to include stacked contributions while retaining its main/master push filter.

Local CI runner verification: 80 cases passed with pytest 8.4.2 / pytest-asyncio 0.26.0, no skips. The fixed test-tool versions fit the declared development constraints. Workflow YAML/path/install-policy checks and script compilation passed; synthetic empty and skipped JUnit reports were correctly rejected. Report output uses the existing ignored test-results directory. The first hosted run remains to verify the runner's exact branch lock installation.
