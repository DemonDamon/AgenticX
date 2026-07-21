"""Tests for deterministic module-summary change planning.

Author: Damon Li
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "scan_changes.py"


def run(command: list[str], cwd: Path, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise AssertionError(
            f"command failed ({result.returncode}): {' '.join(command)}\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def git(repo: Path, *args: str) -> str:
    return run(["git", *args], repo).stdout.strip()


def commit(repo: Path, message: str, *paths: str) -> str:
    git(repo, "add", "-A", "--", *paths)
    git(repo, "commit", "-m", message)
    return git(repo, "rev-parse", "HEAD")


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def make_repo(tmp_path: Path) -> tuple[Path, Path]:
    repo = tmp_path / "repo"
    repo.mkdir()
    run(["git", "init", "-b", "main"], repo)
    git(repo, "config", "user.name", "Test User")
    git(repo, "config", "user.email", "test@example.com")

    write(repo / "README.md", "# fixture\n")
    commit(repo, "initial", "README.md")

    control = repo / "code-summaries"
    write(
        control / "registry.json",
        json.dumps(
            {
                "schema_version": 1,
                "layout": "centralized",
                "tracked_ref": "HEAD",
                "exclude_paths": ["README.md"],
                "modules": [
                    {
                        "id": "alpha",
                        "name": "Alpha",
                        "roots": ["packages/alpha"],
                        "shared_paths": [],
                        "summary_path": "code-summaries/modules/alpha.md",
                        "mapping_revision": 1,
                    },
                    {
                        "id": "beta",
                        "name": "Beta",
                        "roots": ["packages/beta"],
                        "shared_paths": [],
                        "summary_path": "code-summaries/modules/beta.md",
                        "mapping_revision": 1,
                    },
                ],
            },
            indent=2,
        )
        + "\n",
    )
    return repo, control


def cli(repo: Path, control: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return run(
        [
            sys.executable,
            str(SCRIPT),
            *args,
            "--repo",
            str(repo),
            "--control-dir",
            str(control),
        ],
        repo,
        check=check,
    )


def checkpoint(
    repo: Path,
    control: Path,
    module_id: str,
    target: str,
    *,
    summary_content: str | None = None,
) -> dict[str, object]:
    plan_result, plan_payload = plan(repo, control, module_id)
    assert plan_result.returncode == 0
    module_plan = plan_payload["modules"][0]
    summary_path = repo / module_plan["summary_path"]
    if summary_content is not None or not summary_path.exists():
        write(
            summary_path,
            summary_content or f"# {module_plan['name']}\n",
        )
    result = cli(
        repo,
        control,
        "checkpoint",
        "--module",
        module_id,
        "--target",
        target,
        "--target-ref",
        "HEAD",
        "--plan-token",
        module_plan["checkpoint_token"],
        "--summary-sha256-at-plan",
        module_plan["summary_sha256_at_plan"],
    )
    return json.loads(result.stdout)


def plan(
    repo: Path,
    control: Path,
    module_id: str,
    *extra: str,
    check: bool = True,
) -> tuple[subprocess.CompletedProcess[str], dict[str, object]]:
    result = cli(
        repo,
        control,
        "plan",
        "--module",
        module_id,
        *extra,
        check=check,
    )
    return result, json.loads(result.stdout)


def test_each_module_keeps_an_independent_incremental_baseline(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    write(repo / "packages" / "beta" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add modules", "packages/alpha", "packages/beta")
    checkpoint(repo, control, "alpha", first)
    checkpoint(repo, control, "beta", first)

    write(repo / "packages" / "alpha" / "core.py", "VALUE = 2\n")
    second = commit(repo, "change alpha", "packages/alpha/core.py")
    checkpoint(
        repo,
        control,
        "alpha",
        second,
        summary_content="# Alpha\n\nSecond version.\n",
    )

    write(repo / "packages" / "alpha" / "core.py", "VALUE = 3\n")
    write(repo / "packages" / "beta" / "core.py", "VALUE = 2\n")
    third = commit(
        repo,
        "change both",
        "packages/alpha/core.py",
        "packages/beta/core.py",
    )

    _, alpha_plan = plan(repo, control, "alpha")
    _, beta_plan = plan(repo, control, "beta")
    alpha = alpha_plan["modules"][0]
    beta = beta_plan["modules"][0]

    assert alpha["baseline_commit"] == second
    assert beta["baseline_commit"] == first
    assert alpha["target_commit"] == third
    assert beta["target_commit"] == third
    assert [change["new_path"] for change in alpha["changes"]] == [
        "packages/alpha/core.py"
    ]
    assert [change["new_path"] for change in beta["changes"]] == [
        "packages/beta/core.py"
    ]


def test_plan_reports_rename_and_delete_with_old_and_new_paths(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "old.py", "VALUE = 1\n")
    write(repo / "packages" / "alpha" / "drop.py", "DROP = True\n")
    first = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", first)

    git(repo, "mv", "packages/alpha/old.py", "packages/alpha/new.py")
    git(repo, "rm", "packages/alpha/drop.py")
    commit(repo, "rename and delete", "packages/alpha")

    _, payload = plan(repo, control, "alpha")
    changes = payload["modules"][0]["changes"]

    assert {
        (change["status"][0], change["old_path"], change["new_path"])
        for change in changes
    } == {
        ("R", "packages/alpha/old.py", "packages/alpha/new.py"),
        ("D", "packages/alpha/drop.py", None),
    }


def test_plan_fails_closed_when_baseline_is_not_an_ancestor(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    root = git(repo, "rev-parse", "HEAD")
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    abandoned = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", abandoned)

    git(repo, "reset", "--hard", root)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 99\n")
    commit(repo, "rewritten alpha", "packages/alpha")

    result, payload = plan(repo, control, "alpha", check=False)

    assert result.returncode == 2
    assert payload["has_blockers"] is True
    assert payload["modules"][0]["status"] == "blocked"
    assert "HISTORY_DIVERGED" in payload["modules"][0]["blockers"]


def test_dirty_target_module_blocks_unless_head_only_is_explicit(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", first)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 2\n")

    blocked_result, blocked = plan(repo, control, "alpha", check=False)
    _, head_only = plan(repo, control, "alpha", "--head-only")

    assert blocked_result.returncode == 2
    assert "DIRTY_WORKTREE" in blocked["modules"][0]["blockers"]
    assert head_only["modules"][0]["status"] == "unchanged"
    assert "DIRTY_WORKTREE_IGNORED" in head_only["modules"][0]["warnings"]


def test_summary_drift_requires_explicit_acceptance(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", first)
    write(control / "modules" / "alpha.md", "# Alpha\n\nManual note.\n")

    blocked_result, blocked = plan(repo, control, "alpha", check=False)
    _, accepted = plan(repo, control, "alpha", "--accept-summary-drift")

    assert blocked_result.returncode == 2
    assert "SUMMARY_DRIFT" in blocked["modules"][0]["blockers"]
    assert accepted["modules"][0]["status"] == "unchanged"
    assert "SUMMARY_DRIFT_ACCEPTED" in accepted["modules"][0]["warnings"]


def test_deleted_module_is_reported_without_writing_state(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", first)
    state_path = control / "state" / "alpha.json"
    state_before = state_path.read_bytes()

    git(repo, "rm", "-r", "packages/alpha")
    git(repo, "commit", "-m", "remove alpha")

    result, payload = plan(repo, control, "alpha", check=False)

    assert result.returncode == 2
    assert payload["modules"][0]["status"] == "deleted"
    assert "MODULE_DELETED" in payload["modules"][0]["blockers"]
    assert state_path.read_bytes() == state_before


def test_checkpoint_requires_the_token_from_a_clean_plan(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    target = commit(repo, "add alpha", "packages/alpha")
    write(control / "modules" / "alpha.md", "# Alpha\n")

    result = cli(
        repo,
        control,
        "checkpoint",
        "--module",
        "alpha",
        "--target",
        target,
        "--target-ref",
        "HEAD",
        check=False,
    )

    assert result.returncode == 2
    assert "--plan-token" in result.stderr
    assert not (control / "state" / "alpha.json").exists()


def test_changed_module_cannot_checkpoint_an_unchanged_summary_by_accident(
    tmp_path: Path,
) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", first)

    write(repo / "packages" / "alpha" / "core.py", "VALUE = 2\n")
    target = commit(repo, "change alpha", "packages/alpha/core.py")
    _, payload = plan(repo, control, "alpha")
    module_plan = payload["modules"][0]
    assert module_plan["status"] == "changed"

    blocked = cli(
        repo,
        control,
        "checkpoint",
        "--module",
        "alpha",
        "--target",
        target,
        "--target-ref",
        "HEAD",
        "--plan-token",
        module_plan["checkpoint_token"],
        "--summary-sha256-at-plan",
        module_plan["summary_sha256_at_plan"],
        check=False,
    )
    accepted = cli(
        repo,
        control,
        "checkpoint",
        "--module",
        "alpha",
        "--target",
        target,
        "--target-ref",
        "HEAD",
        "--plan-token",
        module_plan["checkpoint_token"],
        "--summary-sha256-at-plan",
        module_plan["summary_sha256_at_plan"],
        "--summary-unchanged",
    )

    assert blocked.returncode == 2
    assert "SUMMARY_NOT_UPDATED" in blocked.stderr
    assert json.loads(accepted.stdout)["status"] == "checkpointed"


def test_checkpoint_supports_a_frozen_custom_target_ref(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", first)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 2\n")
    commit(repo, "change alpha", "packages/alpha/core.py")

    _, payload = plan(repo, control, "alpha", "--target", first)
    module_plan = payload["modules"][0]
    result = cli(
        repo,
        control,
        "checkpoint",
        "--module",
        "alpha",
        "--target",
        first,
        "--target-ref",
        first,
        "--plan-token",
        module_plan["checkpoint_token"],
        "--summary-sha256-at-plan",
        module_plan["summary_sha256_at_plan"],
    )

    assert json.loads(result.stdout)["target_commit"] == first


def test_existing_summary_without_state_requires_explicit_adoption(
    tmp_path: Path,
) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    commit(repo, "add alpha", "packages/alpha")
    write(control / "modules" / "alpha.md", "# Human-authored Alpha\n")

    blocked_result, blocked = plan(repo, control, "alpha", check=False)
    _, adopted = plan(repo, control, "alpha", "--adopt-existing-summary")

    assert blocked_result.returncode == 2
    assert "SUMMARY_WITHOUT_STATE" in blocked["modules"][0]["blockers"]
    assert adopted["modules"][0]["status"] == "new"
    assert "EXISTING_SUMMARY_ADOPTED" in adopted["modules"][0]["warnings"]
    assert adopted["modules"][0]["checkpoint_token"]


def test_invalid_module_id_cannot_escape_the_state_directory(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    registry_path = control / "registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["modules"][0]["id"] = "../../escape"
    write(registry_path, json.dumps(registry))
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    commit(repo, "add alpha", "packages/alpha")

    result = cli(
        repo,
        control,
        "plan",
        "--module",
        "../../escape",
        check=False,
    )

    assert result.returncode == 2
    assert "invalid module id" in result.stderr.lower()
    assert not (repo / "escape.json").exists()


def test_abbreviated_baseline_oid_is_rejected(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", first)
    state_path = control / "state" / "alpha.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["baseline_commit"] = first[:8]
    write(state_path, json.dumps(state))

    result, payload = plan(repo, control, "alpha", check=False)

    assert result.returncode == 2
    assert "INVALID_BASELINE_OID" in payload["modules"][0]["blockers"]


def test_rebaseline_requires_an_explicit_unchanged_summary_review(
    tmp_path: Path,
) -> None:
    repo, control = make_repo(tmp_path)
    root = git(repo, "rev-parse", "HEAD")
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    abandoned = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", abandoned)

    git(repo, "reset", "--hard", root)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 99\n")
    target = commit(repo, "rewrite alpha", "packages/alpha")
    _, recovery_plan = plan(repo, control, "alpha", "--rebaseline")
    module_plan = recovery_plan["modules"][0]
    common_args = (
        "checkpoint",
        "--module",
        "alpha",
        "--target",
        target,
        "--target-ref",
        "HEAD",
        "--rebaseline",
        "--reason",
        "history rewritten; full module reviewed",
        "--plan-token",
        module_plan["checkpoint_token"],
        "--summary-sha256-at-plan",
        module_plan["summary_sha256_at_plan"],
    )

    blocked = cli(repo, control, *common_args, check=False)
    accepted = cli(repo, control, *common_args, "--summary-unchanged")

    assert blocked.returncode == 2
    assert "REBASELINE_SUMMARY_NOT_REBUILT" in blocked.stderr
    assert json.loads(accepted.stdout)["status"] == "checkpointed"


def test_summary_symlink_cannot_escape_the_repository(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (control / "modules").symlink_to(outside, target_is_directory=True)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    commit(repo, "add alpha", "packages/alpha")

    result = cli(repo, control, "plan", "--module", "alpha", check=False)

    assert result.returncode == 2
    assert "summary path must be inside the Git repository" in result.stderr


def test_blocked_multi_module_plan_issues_no_checkpoint_tokens(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    write(repo / "packages" / "beta" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add modules", "packages/alpha", "packages/beta")
    checkpoint(repo, control, "alpha", first)
    checkpoint(repo, control, "beta", first)

    write(repo / "packages" / "beta" / "core.py", "VALUE = 2\n")
    commit(repo, "change beta", "packages/beta/core.py")
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 2\n")

    result = cli(repo, control, "plan", check=False)
    payload = json.loads(result.stdout)

    assert result.returncode == 2
    assert payload["has_blockers"] is True
    assert all(module["checkpoint_token"] is None for module in payload["modules"])


def test_plan_token_is_bound_to_the_planned_target_ref(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", first)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 2\n")
    planned_target = commit(repo, "change alpha", "packages/alpha/core.py")
    _, payload = plan(repo, control, "alpha", "--target", "HEAD")
    module_plan = payload["modules"][0]
    write(control / "modules" / "alpha.md", "# Alpha\n\nUpdated.\n")
    write(repo / "unrelated.txt", "move HEAD\n")
    commit(repo, "move head", "unrelated.txt")

    result = cli(
        repo,
        control,
        "checkpoint",
        "--module",
        "alpha",
        "--target",
        planned_target,
        "--target-ref",
        planned_target,
        "--plan-token",
        module_plan["checkpoint_token"],
        "--summary-sha256-at-plan",
        module_plan["summary_sha256_at_plan"],
        check=False,
    )

    assert result.returncode == 2
    assert "PLAN_TOKEN_MISMATCH" in result.stderr


def test_preexisting_summary_drift_cannot_masquerade_as_this_update(
    tmp_path: Path,
) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", first)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 2\n")
    target = commit(repo, "change alpha", "packages/alpha/core.py")
    write(control / "modules" / "alpha.md", "# Alpha\n\nUnrelated manual note.\n")
    _, payload = plan(repo, control, "alpha", "--accept-summary-drift")
    module_plan = payload["modules"][0]

    result = cli(
        repo,
        control,
        "checkpoint",
        "--module",
        "alpha",
        "--target",
        target,
        "--target-ref",
        "HEAD",
        "--accept-summary-drift",
        "--plan-token",
        module_plan["checkpoint_token"],
        "--summary-sha256-at-plan",
        module_plan["summary_sha256_at_plan"],
        check=False,
    )

    assert result.returncode == 2
    assert "SUMMARY_NOT_UPDATED" in result.stderr


def test_checkpoint_token_cannot_be_replayed(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    target = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", target)
    _, payload = plan(repo, control, "alpha")
    module_plan = payload["modules"][0]
    command = (
        "checkpoint",
        "--module",
        "alpha",
        "--target",
        target,
        "--target-ref",
        "HEAD",
        "--plan-token",
        module_plan["checkpoint_token"],
        "--summary-sha256-at-plan",
        module_plan["summary_sha256_at_plan"],
    )

    first = cli(repo, control, *command)
    replay = cli(repo, control, *command, check=False)

    assert json.loads(first.stdout)["status"] == "checkpointed"
    assert replay.returncode == 2
    assert "PLAN_TOKEN_MISMATCH" in replay.stderr


def test_mapping_refresh_has_an_explicit_plan_and_checkpoint_path(
    tmp_path: Path,
) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    target = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", target)
    registry_path = control / "registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["modules"][0]["mapping_revision"] = 2
    write(registry_path, json.dumps(registry))

    blocked_result, blocked = plan(repo, control, "alpha", check=False)
    _, refresh = plan(repo, control, "alpha", "--mapping-refresh")
    module_plan = refresh["modules"][0]
    write(control / "modules" / "alpha.md", "# Alpha\n\nMapping refreshed.\n")
    checkpoint_result = cli(
        repo,
        control,
        "checkpoint",
        "--module",
        "alpha",
        "--target",
        target,
        "--target-ref",
        "HEAD",
        "--mapping-refresh",
        "--reason",
        "module boundary reviewed",
        "--plan-token",
        module_plan["checkpoint_token"],
        "--summary-sha256-at-plan",
        module_plan["summary_sha256_at_plan"],
    )

    assert blocked_result.returncode == 2
    assert "MAPPING_REVISION_CHANGED" in blocked["modules"][0]["blockers"]
    assert "MAPPING_REFRESH_REQUIRED" in module_plan["warnings"]
    assert json.loads(checkpoint_result.stdout)["status"] == "checkpointed"


def test_full_plan_blocks_unassigned_tracked_paths(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    write(repo / "packages" / "beta" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add modules", "packages/alpha", "packages/beta")
    checkpoint(repo, control, "alpha", first)
    checkpoint(repo, control, "beta", first)
    write(repo / "services" / "new-service" / "main.py", "VALUE = 1\n")
    commit(repo, "add unregistered service", "services/new-service")

    result = cli(repo, control, "plan", check=False)
    payload = json.loads(result.stdout)

    assert result.returncode == 2
    assert "UNASSIGNED_TRACKED_PATHS" in payload["global_blockers"]
    assert payload["unassigned_paths"] == ["services/new-service/main.py"]


def test_colocated_layout_requires_primary_root_and_exact_summary_name(
    tmp_path: Path,
) -> None:
    repo, control = make_repo(tmp_path)
    registry_path = control / "registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["layout"] = "colocated"
    registry["summary_name"] = "MODULE.md"
    registry["modules"][1]["summary_path"] = "packages/beta/MODULE.md"
    registry["modules"][0]["roots"] = [
        "packages/alpha",
        "tests/alpha",
    ]
    registry["modules"][0]["summary_path"] = "packages/alpha/WRONG.md"
    write(registry_path, json.dumps(registry))
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    write(repo / "tests" / "alpha" / "test_core.py", "def test_core(): pass\n")
    commit(repo, "add alpha", "packages/alpha", "tests/alpha")

    missing_primary = cli(
        repo,
        control,
        "plan",
        "--module",
        "alpha",
        check=False,
    )
    registry["modules"][0]["primary_root"] = "packages/alpha"
    write(registry_path, json.dumps(registry))
    wrong_name = cli(
        repo,
        control,
        "plan",
        "--module",
        "alpha",
        check=False,
    )
    registry["modules"][0]["summary_path"] = "packages/alpha/MODULE.md"
    write(registry_path, json.dumps(registry))
    valid = cli(repo, control, "plan", "--module", "alpha")

    assert "must declare primary_root" in missing_primary.stderr
    assert "must be packages/alpha/MODULE.md" in wrong_name.stderr
    assert json.loads(valid.stdout)["modules"][0]["status"] == "new"


def test_exclude_paths_are_removed_from_module_change_inputs(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    registry_path = control / "registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["exclude_paths"].append("packages/alpha/generated")
    write(registry_path, json.dumps(registry))
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    write(repo / "packages" / "alpha" / "generated" / "api.py", "VALUE = 1\n")
    first = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", first)

    write(repo / "packages" / "alpha" / "generated" / "api.py", "VALUE = 2\n")
    commit(repo, "regenerate alpha", "packages/alpha/generated/api.py")
    _, payload = plan(repo, control, "alpha")

    assert payload["modules"][0]["status"] == "unchanged"
    assert payload["modules"][0]["changes"] == []


def test_control_directory_cannot_contain_a_module_root(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    registry_path = control / "registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["modules"][0]["roots"] = ["code-summaries/source"]
    write(registry_path, json.dumps(registry))
    write(control / "source" / "core.py", "VALUE = 1\n")
    commit(repo, "add misplaced source", "code-summaries/source")

    result = cli(repo, control, "plan", "--module", "alpha", check=False)

    assert result.returncode == 2
    assert "control directory cannot contain module root" in result.stderr


def test_empty_new_module_is_blocked_during_plan(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)

    result, payload = plan(repo, control, "alpha", check=False)

    assert result.returncode == 2
    assert payload["modules"][0]["status"] == "blocked"
    assert "MODULE_EMPTY" in payload["modules"][0]["blockers"]


def test_accept_summary_drift_cannot_be_pre_authorized(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    target = commit(repo, "add alpha", "packages/alpha")
    checkpoint(repo, control, "alpha", target)

    result, payload = plan(
        repo,
        control,
        "alpha",
        "--accept-summary-drift",
        check=False,
    )

    assert result.returncode == 2
    assert "SUMMARY_DRIFT_NOT_PRESENT" in payload["modules"][0]["blockers"]


def test_mapping_refresh_also_blocks_unassigned_tracked_paths(
    tmp_path: Path,
) -> None:
    repo, control = make_repo(tmp_path)
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    write(repo / "packages" / "beta" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add modules", "packages/alpha", "packages/beta")
    checkpoint(repo, control, "alpha", first)
    checkpoint(repo, control, "beta", first)
    registry_path = control / "registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["modules"][0]["mapping_revision"] = 2
    write(registry_path, json.dumps(registry))
    write(repo / "services" / "new-service" / "main.py", "VALUE = 1\n")
    commit(repo, "add unregistered service", "services/new-service")

    result, payload = plan(
        repo,
        control,
        "alpha",
        "--mapping-refresh",
        check=False,
    )

    assert result.returncode == 2
    assert "UNASSIGNED_TRACKED_PATHS" in payload["global_blockers"]
    assert payload["modules"][0]["checkpoint_token"] is None


def test_retired_module_id_cannot_be_reused_as_active(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    registry_path = control / "registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["retired_modules"] = [{"id": "alpha"}]
    write(registry_path, json.dumps(registry))
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    commit(repo, "add alpha", "packages/alpha")

    result = cli(repo, control, "plan", "--module", "alpha", check=False)

    assert result.returncode == 2
    assert "retired module id cannot be reused" in result.stderr


def test_custom_layout_allows_arbitrary_nested_summary_path(
    tmp_path: Path,
) -> None:
    repo, control = make_repo(tmp_path)
    registry_path = control / "registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["layout"] = "custom"
    registry["modules"][0]["summary_path"] = (
        "docs-conclusions/apps/alpha_conclusion.md"
    )
    write(registry_path, json.dumps(registry))
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    first = commit(repo, "add alpha", "packages/alpha")

    checkpoint(repo, control, "alpha", first)
    assert (repo / "docs-conclusions" / "apps" / "alpha_conclusion.md").is_file()

    _, unchanged = plan(repo, control, "alpha")
    assert unchanged["modules"][0]["status"] == "unchanged"

    write(repo / "packages" / "alpha" / "core.py", "VALUE = 2\n")
    commit(repo, "change alpha", "packages/alpha/core.py")
    _, changed = plan(repo, control, "alpha")
    assert changed["modules"][0]["status"] == "changed"


def test_custom_layout_requires_markdown_summary_path(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    registry_path = control / "registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["layout"] = "custom"
    registry["modules"][0]["summary_path"] = (
        "docs-conclusions/apps/alpha_conclusion.txt"
    )
    write(registry_path, json.dumps(registry))
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    commit(repo, "add alpha", "packages/alpha")

    result = cli(repo, control, "plan", "--module", "alpha", check=False)

    assert result.returncode == 2
    assert "must be a Markdown file" in result.stderr


def test_custom_index_path_is_managed(tmp_path: Path) -> None:
    repo, control = make_repo(tmp_path)
    registry_path = control / "registry.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    registry["layout"] = "custom"
    registry["index_path"] = "docs-conclusions/README.md"
    registry["modules"][0]["summary_path"] = (
        "docs-conclusions/apps/alpha_conclusion.md"
    )
    registry["modules"][1]["summary_path"] = (
        "docs-conclusions/apps/beta_conclusion.md"
    )
    write(registry_path, json.dumps(registry))
    write(repo / "packages" / "alpha" / "core.py", "VALUE = 1\n")
    write(repo / "packages" / "beta" / "core.py", "VALUE = 1\n")
    write(repo / "docs-conclusions" / "README.md", "# overview\n")
    first = commit(
        repo,
        "add modules and overview",
        "packages/alpha",
        "packages/beta",
        "docs-conclusions/README.md",
    )
    checkpoint(repo, control, "alpha", first)
    checkpoint(repo, control, "beta", first)

    full = cli(repo, control, "plan")
    payload = json.loads(full.stdout)
    assert full.returncode == 0
    assert "UNASSIGNED_TRACKED_PATHS" not in payload["global_blockers"]
    assert payload["unassigned_paths"] == []

    write(repo / "docs-conclusions" / "README.md", "# overview v2\n")
    commit(repo, "update overview", "docs-conclusions/README.md")
    _, alpha_payload = plan(repo, control, "alpha")
    _, beta_payload = plan(repo, control, "beta")
    assert alpha_payload["modules"][0]["status"] == "unchanged"
    assert beta_payload["modules"][0]["status"] == "unchanged"
