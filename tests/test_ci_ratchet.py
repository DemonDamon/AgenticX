"""Tests for the invariant ratchet (scripts/ci/ratchet.py) and its wiring into
the Python regression gate.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "ci"))

import ratchet  # noqa: E402

LEDGER_READ = 'run_dir / "events.jsonl"'
LEDGER_RULE = {
    "id": "ledger-read-bypass",
    "description": "Ledger reads go through the ledger package.",
    "exclude": ["agenticx/runtime/replay_ledger/"],
    "patterns": [LEDGER_READ, "runs/*/events.jsonl"],
    "baseline": 2,
}
MALFORMED = [
    "not json",
    "{}",
    '{"rules": []}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("]}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("],'
    ' "baseline": 1, "note": "typo"}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": "1"}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": -1}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": true}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": [], "baseline": 1}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": 1},'
    ' {"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": 1}]}',
]
GATE = ratchet.ROOT / "scripts" / "ci" / "python-regressions.py"
# Suites that keep the runtime invariants under test; the gate must keep selecting them.
INVARIANT_SUITES = (
    "tests/test_ci_ratchet.py",
    "tests/test_replay_ledger_upcast.py",
    "tests/test_replay_ledger_payload_summary.py",
    "tests/test_replay_ledger_resume_anchor.py",
    "tests/test_ledger_resume_recovery.py",
    "tests/test_ledger_reattach_stream.py",
    "tests/test_ha_checkpoint_resume.py",
)


def _git(root: Path, *args: str) -> None:
    """Run git in ``root`` with a test identity and without the developer's global config."""
    env = {
        **os.environ,
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_AUTHOR_NAME": "ratchet tests",
        "GIT_AUTHOR_EMAIL": "ratchet@invalid",
        "GIT_COMMITTER_NAME": "ratchet tests",
        "GIT_COMMITTER_EMAIL": "ratchet@invalid",
    }
    subprocess.run(["git", *args], cwd=root, env=env, check=True, capture_output=True)


def _rule(rule_id: str, patterns: list[str], baseline: int) -> dict:
    return {
        "id": rule_id,
        "description": f"Rule {rule_id}",
        "exclude": [],
        "patterns": patterns,
        "baseline": baseline,
    }


def _write_baseline(root: Path, *rules: dict) -> None:
    path = root / ratchet.BASELINE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"rules": list(rules)}, indent=2) + "\n", encoding="utf-8")


def _repo(tmp_path: Path, files: dict[str, str], *rules: dict) -> Path:
    """Commit ``files`` under agenticx/ plus ``rules`` on ``main``."""
    _git(tmp_path, "init", "-q", "-b", "main")
    if rules:
        _write_baseline(tmp_path, *rules)
    for name, text in files.items():
        path = tmp_path / "agenticx" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-q", "-m", "init")
    return tmp_path


def _pull_request(root: Path, *rules: dict) -> None:
    """Rewrite the baseline on a feature branch, the way a pull request does."""
    _git(root, "checkout", "-q", "-b", "feature")
    _write_baseline(root, *rules)
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "update")


def _run(
    root: Path,
    capsys: pytest.CaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
    base_ref: str | None = None,
) -> tuple[int, str]:
    """Run the ratchet against ``root`` and return its exit code with its output."""
    monkeypatch.setattr(ratchet, "ROOT", root)
    if base_ref is None:
        monkeypatch.delenv(ratchet.BASE_REF_ENV, raising=False)
    else:
        monkeypatch.setenv(ratchet.BASE_REF_ENV, base_ref)
    code = ratchet.main()
    return code, capsys.readouterr().out


def test_counts_each_matching_line_once_over_tracked_files_only(tmp_path: Path) -> None:
    repo = _repo(
        tmp_path,
        {
            # The second line holds both patterns and still counts once.
            "a.py": f"x = {LEDGER_READ}\ny = z  # {LEDGER_READ} or runs/*/events.jsonl\nplain = 1\n",
            "sub/b.py": f"x = {LEDGER_READ}\n",
            "runtime/replay_ledger/store.py": f"events_path = {LEDGER_READ}\n",
            "skills/notes.md": f"see {LEDGER_READ}\n",
        },
        LEDGER_RULE,
    )
    (repo / "agenticx" / "untracked.py").write_text(f"x = {LEDGER_READ}\n", encoding="utf-8")
    # A tracked symlink is listed, but the text it points at is not a file in the tree.
    outside = tmp_path / "outside.txt"
    outside.write_text(f"x = {LEDGER_READ}\n", encoding="utf-8")
    (repo / "agenticx" / "link.py").symlink_to(outside)
    _git(repo, "add", "agenticx/link.py")

    files = ratchet.tracked_files(repo)

    assert "agenticx/untracked.py" not in files
    assert "agenticx/link.py" in files
    assert ratchet.count_lines(repo, LEDGER_RULE, files) == 4


def test_passes_when_every_count_fits_its_baseline(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 1))

    code, out = _run(repo, capsys, monkeypatch)

    assert code == 0
    assert "ratchet: r: 1 line(s), baseline 1\n" in out
    assert f"ratchet: no base baseline to compare ({ratchet.BASE_REF_ENV} is unset" in out
    assert out.rstrip().endswith("ratchet: passed")


def test_fails_when_the_count_exceeds_the_baseline(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 0))

    code, out = _run(repo, capsys, monkeypatch)

    assert code == 1
    assert "ratchet: FAIL r: 1 matching line(s) exceed the baseline of 0\n" in out


def test_passes_below_the_baseline_and_suggests_tightening(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 3))

    code, out = _run(repo, capsys, monkeypatch)

    assert code == 0
    assert "ratchet: r: 1 line(s), baseline 3; the baseline can be tightened\n" in out


def test_raised_baseline_fails_against_the_target_branch(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 1))
    _pull_request(repo, _rule("r", [LEDGER_READ], 2))

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 1
    assert "ratchet: baselines compared with main\n" in out
    assert "ratchet: FAIL r: baseline raised from 1 to 2\n" in out


def test_lowered_baseline_passes_against_the_target_branch(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 2))
    _pull_request(repo, _rule("r", [LEDGER_READ], 1))

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 0
    assert "ratchet: baselines compared with main\n" in out


def test_removed_rule_fails_even_when_the_counts_fit(tmp_path, monkeypatch, capsys) -> None:
    first = _rule("first", [LEDGER_READ], 1)
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, first, _rule("second", ["save_agent_state("], 0))
    _pull_request(repo, first)

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 1
    assert "ratchet: FAIL second: rule removed\n" in out


def test_new_rule_is_allowed_but_ratcheted(tmp_path, monkeypatch, capsys) -> None:
    first = _rule("first", [LEDGER_READ], 1)
    second = _rule("second", ["save_agent_state("], 0)
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, first)
    _pull_request(repo, first, second)

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 0
    # Only tracked files are scanned, so stage the new bypass first.
    (repo / "agenticx" / "b.py").write_text("store.save_agent_state(sid, {})\n", encoding="utf-8")
    _git(repo, "add", "-A")

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 1
    assert "ratchet: FAIL second: 1 matching line(s) exceed the baseline of 0\n" in out


def test_target_branch_without_a_baseline_file_only_gets_the_count_check(
    tmp_path, monkeypatch, capsys
) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"})
    _pull_request(repo, _rule("r", [LEDGER_READ], 5))

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 0
    assert "no base baseline to compare" in out


def test_unknown_base_ref_fails_instead_of_skipping_the_comparison(
    tmp_path, monkeypatch, capsys
) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 1))

    code, out = _run(repo, capsys, monkeypatch, base_ref="origin/no-such-branch")

    assert code == 1
    assert "ratchet: error: base ref 'origin/no-such-branch' is not a commit in this clone" in out


def test_unreadable_base_baseline_fails_loudly(tmp_path, monkeypatch, capsys) -> None:
    """Only an absent path may skip the comparison; a failed read may not."""
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 1))
    real_git = ratchet._git

    def broken_show(root: Path, *args: str) -> subprocess.CompletedProcess:
        if args[0] == "show":
            return subprocess.CompletedProcess(args, 128, b"", b"fatal: bad object\n")
        return real_git(root, *args)

    monkeypatch.setattr(ratchet, "_git", broken_show)

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 1
    assert f"ratchet: error: cannot read {ratchet.BASELINE_PATH} from 'main': fatal: bad object" in out


def test_missing_baseline_file_fails_loudly(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"})

    code, out = _run(repo, capsys, monkeypatch)

    assert code == 1
    assert f"ratchet: error: " in out and ratchet.BASELINE_PATH in out


@pytest.mark.parametrize("document", MALFORMED)
def test_malformed_baseline_is_rejected(document: str) -> None:
    with pytest.raises(ratchet.RatchetError):
        ratchet.parse_baseline(document)


def test_repository_baseline_keeps_the_startup_rules() -> None:
    rules = ratchet.parse_baseline((ratchet.ROOT / ratchet.BASELINE_PATH).read_text(encoding="utf-8"))

    assert {"ledger-read-bypass", "checkpoint-save-bypass", "resume-anchor-bypass"} <= set(rules)


def test_gate_runs_the_ratchet_before_the_tests() -> None:
    """An unusable base ref must stop the gate before any test runs."""
    result = subprocess.run(
        [sys.executable, str(GATE)],
        cwd=ratchet.ROOT,
        env={**os.environ, ratchet.BASE_REF_ENV: "origin/no-such-branch"},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert "ratchet: error: base ref 'origin/no-such-branch'" in result.stdout
    assert "Required dependency imported" not in result.stdout


def test_gate_list_mode_skips_the_ratchet_and_keeps_the_invariant_suites() -> None:
    result = subprocess.run(
        [sys.executable, str(GATE), "--list"],
        cwd=ratchet.ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "ratchet:" not in result.stdout
    listed = {line.strip() for line in result.stdout.splitlines()}
    assert set(INVARIANT_SUITES) <= listed
