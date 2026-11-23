# model-sdk-baseline

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

## Evidence and scope
`pyproject.toml:60` and `requirements.txt` allow an unqualified old model SDK range; `requirements.lock` selects 1.80.11. The Python integration uses SDK interfaces, not a separately deployed proxy.
FR1: Pin the verified maintained stable SDK release 1.105.7 in source manifests. Re-resolve only its necessary dependency closure using the existing lock as preferences; do not copy a business lock or globally upgrade unrelated packages.
FR2: Add real SDK mock HTTP/SSE contract tests for model naming, text/reasoning/tool deltas and usage. Validate Python 3.10 and the packaging Python 3.12 resolver paths.
AC: `tests/test_litellm_sdk_stream_compatibility.py`, existing stream/reasoning adapter tests, dry-run resolution on Python 3.10/3.12, wheel SHA256 checked against official PyPI metadata. Desktop cold-start/import smoke is required; full binary packaging is reported separately.
Out of scope: model routing behavior, proxy-server deployment, upgrading every dependency.
Sources: https://pypi.org/project/litellm/1.105.7/ ; https://github.com/BerriAI/litellm/releases/tag/v1.105.7 . Official metadata requires Python >=3.10,<3.15.

## Target selection evidence
The real function-tool stream reproduces upstream issue https://github.com/BerriAI/litellm/issues/46045 on 1.108.0 with the current MCP 1.x dependency: CacheableResult import fails before any network call. The maintained stable/1.105.x release 1.105.7 (official tag 3f775a9, released 2026-10-28) receives the same current proxy gzip patch as stable/1.106.x: https://github.com/BerriAI/litellm/releases/tag/v1.105.7 . We select it for runtime compatibility, not to bypass security validation. PyPI's per-version vulnerability feed on 2026-11-05 lists no advisories for either evaluated release; this is not a proof that no defects exist. Current integration is SDK-only and does not expose the separate proxy routes.
Official macOS arm64 wheel SHA256: 6f942c5e4f877a42ba943b8328aab911cdf6087cb87a8a4d487cc9f5550f8796.

## Validation
Fresh Python 3.12 core-only environment without MCP: 16 SDK/reasoning/usage tests passed. With the current locked MCP 1.27.2, the expanded suite including a two-round tool-result continuation: 17 passed. Actual versions: model SDK 1.105.7, HTTP SDK 2.54.0, Pydantic 2.12.5, MCP 1.27.2. Studio session lifecycle, avatar session isolation and Meta session isolation smoke: 3 passed. The official arm64 wheel was downloaded and its SHA256 was checked, not merely copied from metadata.
Python 3.10 and 3.12 source dependency combinations both resolve. The checked-in requirements.lock is explicitly generated for Python 3.12, as its existing onnxruntime 1.26.0 wheel is unavailable for 3.10; a 3.10 source install selects compatible 1.23.2. No unrelated model-runtime downgrade was added to the 3.12 lock.
A real Python 3.10 framework test attempt cannot collect because unchanged `agenticx/core/workflow_engine.py:20` imports datetime.UTC (introduced in Python 3.11). This is an existing framework compatibility defect and not reported as a passing 3.10 application runtime. It is outside this dependency-only PR.
PyInstaller discovery finds `litellm.rust_bridge._native` and the offline pricing backup. Full frozen binary build has not been performed in this task.

The direct SDK function-tool probe also passes on real Python 3.10, separately from the framework. The framework datetime.UTC import failure was reproduced in the unchanged main checkout itself.

## Remote regression acceptance
The path-filtered Python 3.12 contribution workflow installs the current branch requirements.lock, fixes compatible test-tool versions and prints its actual branch-local selection. It executes real SDK text/reasoning/tool/usage/multi-round contracts and existing available fault/tool tests; absent tests from independent contributions are explicitly listed. Parser and crypto imports are required whenever their acceptance files exist, and empty or skipped selected suites fail instead of reporting a false green. Model metadata and weight downloads are disabled. The security scan's pull-request trigger covers stacked bases, with push runs limited to main/master. Workflow structure, script compilation and report guard behavior were locally validated, and this branch's selection is run before publishing.

Local CI runner on this branch: 34 cases passed with zero skips under the fixed compatible test tools, including all three real SDK contracts and the existing reasoning/usage regressions. Hosted verification will install this branch's exact lock rather than inheriting a developer environment.
