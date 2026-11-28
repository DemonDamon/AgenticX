#!/usr/bin/env python3
"""Invariant ratchet: greppable counts may only go down.

Every rule in ``ratchet-baseline.json`` counts the lines that contain any of
its literal patterns, over the tracked files under ``agenticx/`` (the set
``git grep`` searches) and outside its excluded path prefixes. A rule fails
when its count exceeds its baseline.

On a pull request the target branch's baseline is read as well
(``RATCHET_BASE_REF`` names a git ref such as ``origin/main``) and compared
rule by rule: a raised baseline or a removed rule fails even when the count
still fits. A new rule is always allowed and is ratcheted like the others.
Without ``RATCHET_BASE_REF`` only the count check runs.

Matching is literal, case-sensitive and per line; a line counts once no
matter how many patterns or occurrences it holds.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASELINE_PATH = "scripts/ci/ratchet-baseline.json"
SCAN_ROOT = "agenticx"
BASE_REF_ENV = "RATCHET_BASE_REF"
RULE_KEYS = frozenset({"baseline", "description", "exclude", "id", "patterns"})


class RatchetError(Exception):
    """A baseline file or base ref that cannot be used; never a silent pass."""


def _git(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, check=False)


def _string_list(value: object) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) and item for item in value)


def parse_baseline(text: str) -> dict[str, dict]:
    """Validate one baseline document and return its rules keyed by id."""
    try:
        document = json.loads(text)
    except ValueError as exc:
        raise RatchetError(f"{BASELINE_PATH} is not valid JSON: {exc}") from exc
    rules = document.get("rules") if isinstance(document, dict) else None
    if not isinstance(rules, list) or not rules:
        raise RatchetError(f'{BASELINE_PATH} must hold a non-empty "rules" list')
    parsed: dict[str, dict] = {}
    for rule in rules:
        if not isinstance(rule, dict) or set(rule) != RULE_KEYS:
            raise RatchetError(f"each rule needs exactly the keys {sorted(RULE_KEYS)}: {rule!r}")
        if any(not isinstance(rule[key], str) or not rule[key].strip() for key in ("id", "description")):
            raise RatchetError(f"id and description must be non-empty strings: {rule!r}")
        if not _string_list(rule["exclude"]) or not _string_list(rule["patterns"]) or not rule["patterns"]:
            raise RatchetError(
                f"exclude and patterns must be lists of non-empty strings, with at least one pattern: {rule!r}"
            )
        if type(rule["baseline"]) is not int or rule["baseline"] < 0:
            raise RatchetError(f"baseline must be an integer of at least 0: {rule!r}")
        if rule["id"] in parsed:
            raise RatchetError(f"duplicate rule id: {rule['id']}")
        parsed[rule["id"]] = rule
    return parsed


def tracked_files(root: Path) -> list[str]:
    """Return the repo-relative paths of the tracked files under the scan root."""
    result = _git(root, "ls-files", "-z", "--", SCAN_ROOT)
    if result.returncode:
        raise RatchetError(f"git ls-files failed: {result.stderr.decode(errors='replace').strip()}")
    names = result.stdout.decode("utf-8", errors="surrogateescape").split("\0")
    return [name for name in names if name]


def count_lines(root: Path, rule: dict, files: list[str]) -> int:
    """Count the lines holding any pattern of ``rule`` outside its excluded prefixes."""
    excluded = tuple(rule["exclude"])
    patterns = tuple(rule["patterns"])
    count = 0
    for name in files:
        if name.startswith(excluded):
            continue
        path = root / name
        if path.is_symlink() or not path.is_file():
            continue  # a symlink, a submodule entry, or a file deleted from the working tree
        lines = path.read_bytes().decode("utf-8", errors="replace").split("\n")
        count += sum(1 for line in lines if any(pattern in line for pattern in patterns))
    return count


def base_rules(root: Path, ref: str) -> dict[str, dict] | None:
    """Return the rules of the baseline file at ``ref``, or None when that ref has none."""
    ref = ref.strip()
    if not ref:
        return None
    if ref.startswith("-"):
        raise RatchetError(f"{BASE_REF_ENV} must name a git ref, got {ref!r}")
    if _git(root, "cat-file", "-e", f"{ref}^{{commit}}").returncode:
        raise RatchetError(
            f"base ref {ref!r} is not a commit in this clone; fetch the target branch first"
        )
    if _git(root, "cat-file", "-e", f"{ref}:{BASELINE_PATH}").returncode:
        return None
    shown = _git(root, "show", f"{ref}:{BASELINE_PATH}")
    if shown.returncode:
        raise RatchetError(
            f"cannot read {BASELINE_PATH} from {ref!r}: {shown.stderr.decode(errors='replace').strip()}"
        )
    return parse_baseline(shown.stdout.decode("utf-8"))


def evaluate(
    counts: dict[str, int], current: dict[str, dict], base: dict[str, dict] | None
) -> list[str]:
    """Return one failure line per ratchet problem; an empty list means the ratchet passes."""
    problems: list[str] = []
    for rule_id, rule in current.items():
        if counts[rule_id] > rule["baseline"]:
            problems.append(
                f"{rule_id}: {counts[rule_id]} matching line(s) exceed the baseline of {rule['baseline']}"
            )
    if base is not None:
        for rule_id, rule in base.items():
            if rule_id not in current:
                problems.append(f"{rule_id}: rule removed")
            elif current[rule_id]["baseline"] > rule["baseline"]:
                problems.append(
                    f"{rule_id}: baseline raised from {rule['baseline']} to {current[rule_id]['baseline']}"
                )
    return problems


def main() -> int:
    try:
        current = parse_baseline((ROOT / BASELINE_PATH).read_text(encoding="utf-8"))
        base = base_rules(ROOT, os.environ.get(BASE_REF_ENV, ""))
        files = tracked_files(ROOT)
    except (OSError, RatchetError, ValueError) as exc:
        print(f"ratchet: error: {exc}", flush=True)
        return 1
    counts = {rule_id: count_lines(ROOT, rule, files) for rule_id, rule in current.items()}
    for rule_id, rule in current.items():
        count, baseline = counts[rule_id], rule["baseline"]
        note = "" if count == baseline else ("; the baseline can be tightened" if count < baseline else "")
        print(f"ratchet: {rule_id}: {count} line(s), baseline {baseline}{note}", flush=True)
    if base is None:
        print(
            f"ratchet: no base baseline to compare ({BASE_REF_ENV} is unset or its ref has no {BASELINE_PATH})",
            flush=True,
        )
    else:
        print(f"ratchet: baselines compared with {os.environ[BASE_REF_ENV].strip()}", flush=True)
    problems = evaluate(counts, current, base)
    for problem in problems:
        print(f"ratchet: FAIL {problem}", flush=True)
    if problems:
        print(
            "ratchet: failed; a baseline may only go down, explain any other change in the pull request",
            flush=True,
        )
        return 1
    print("ratchet: passed", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
