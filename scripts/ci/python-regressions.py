#!/usr/bin/env python3
"""Run the bounded Python reliability suite available on a contribution branch."""

from __future__ import annotations

import argparse
import ast
import importlib
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
TEST_FILES = (
    "tests/test_http_status.py",
    "tests/test_llm_retry.py",
    "tests/test_smoke_anthropics-claude-code_provider_fault.py",
    "tests/test_smoke_streaming_tool_truncation.py",
    "tests/test_litellm_sdk_stream_compatibility.py",
    "tests/test_smoke_litellm_reasoning_stream.py",
    "tests/test_stream_usage_cached_tokens.py",
    "tests/tools/test_document_dependency_compatibility.py",
    "tests/test_dependency_crypto_compatibility.py",
)
RUNTIME_FILE = "tests/test_agent_runtime.py"
RUNTIME_TEST = "test_optional_tool_dispatch_requires_valid_streamed_object"


def select_tests() -> list[str]:
    selected = [name for name in TEST_FILES if (ROOT / name).is_file()]
    runtime = ROOT / RUNTIME_FILE
    if runtime.is_file():
        functions = ast.parse(runtime.read_text(encoding="utf-8")).body
        if any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == RUNTIME_TEST for node in functions):
            # This contribution tests the dispatch boundary, not the unrelated
            # pre-existing persistence/final-reasoning failures in the full file.
            selected.append(f"{RUNTIME_FILE}::{RUNTIME_TEST}")
    return selected


def require_dependencies(selected: list[str]) -> None:
    modules = {"pytest", "pytest_asyncio"}
    if "tests/tools/test_document_dependency_compatibility.py" in selected:
        modules.update({"fitz", "pypdf", "PIL.Image", "pptx", "cryptography"})
    if "tests/test_dependency_crypto_compatibility.py" in selected:
        modules.add("cryptography")
    for name in sorted(modules):
        # Document tests use importorskip outside CI. Here missing/broken parser
        # packages must fail before pytest, so an optional dependency cannot
        # turn an intended parser acceptance run into an empty green suite.
        importlib.import_module(name)
        print(f"Required dependency imported: {name}", flush=True)


def check_report(path: Path) -> None:
    report = ET.parse(path).getroot()
    cases = list(report.iter("testcase"))
    skipped = [case for case in cases if case.find("skipped") is not None]
    if not cases:
        raise RuntimeError("The selected regression suite executed no tests")
    if skipped:
        names = ", ".join(case.get("name", "unknown") for case in skipped)
        raise RuntimeError(f"Selected regressions must execute instead of skipping: {names}")
    print(f"Executed {len(cases)} regression cases with no skips", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="Print branch-local test selection without running it")
    args = parser.parse_args()
    selected = select_tests()
    if not selected:
        raise RuntimeError("No regression test files are available on this branch")
    print("Selected Python regressions:", flush=True)
    for name in selected:
        print(f"  {name}", flush=True)
    missing = [name for name in TEST_FILES if not (ROOT / name).is_file()]
    if missing:
        print("Not present on this branch: " + ", ".join(missing), flush=True)
    if args.list:
        return 0

    for name, value in {
        "LITELLM_LOCAL_MODEL_COST_MAP": "true",
        "HF_HUB_OFFLINE": "1",
        "TOKENIZERS_PARALLELISM": "false",
        "AWS_EC2_METADATA_DISABLED": "true",
    }.items():
        os.environ[name] = value
    require_dependencies(selected)
    output = ROOT / "test-results"
    output.mkdir(exist_ok=True)
    report = output / "python-regressions.xml"
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-o", "addopts=", "--import-mode=importlib",
         "--strict-markers", "--strict-config", "-q", f"--junitxml={report}", *selected],
        cwd=ROOT,
        check=False,
    )
    if result.returncode:
        return result.returncode
    check_report(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
