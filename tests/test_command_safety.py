#!/usr/bin/env python3
"""Segment-by-segment command risk: contained vs approval vs opaque.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.command_safety import (
    COMMAND_RISK_CATEGORIES,
    NEVER_AUTO_APPROVED_CATEGORIES,
    absolute_redirect_targets,
    assess_command,
)


def test_sed_print_range_is_contained() -> None:
    verdict = assess_command("sed -n '1,50p' a.py")
    assert verdict.is_contained
    assert verdict.findings == []


def test_pipe_of_read_only_segments_is_contained() -> None:
    verdict = assess_command("ls | head")
    assert verdict.is_contained


def test_and_of_read_only_segments_is_contained() -> None:
    verdict = assess_command("rg foo && jq . b.json")
    assert verdict.is_contained


def test_find_delete_requires_approval() -> None:
    verdict = assess_command("find . -delete")
    assert not verdict.is_contained
    assert any("-delete" in item.evidence for item in verdict.findings)


def test_find_exec_requires_approval() -> None:
    verdict = assess_command("find . -exec rm {} +")
    assert not verdict.is_contained
    assert any("-exec" in item.evidence for item in verdict.findings)


def test_git_status_contained_push_requires_approval() -> None:
    assert assess_command("git status").is_contained
    push = assess_command("git push")
    assert not push.is_contained


def test_command_substitution_is_opaque() -> None:
    verdict = assess_command("echo $(rm -rf x)")
    assert not verdict.is_contained
    assert verdict.undecidable


def test_absolute_redirect_requires_approval_and_lists_target() -> None:
    command = "cat a.txt > /etc/hosts"
    verdict = assess_command(command)
    # Redirect is stripped for segment classification; the landing is a
    # separate absolute-target gate the caller must overlay.
    assert verdict.is_contained
    assert "/etc/hosts" in absolute_redirect_targets(command)


def test_xargs_rm_requires_approval() -> None:
    verdict = assess_command("xargs rm < list.txt")
    assert not verdict.is_contained


def test_known_dangerous_commands_emit_precise_categories() -> None:
    rm = assess_command("rm -rf /tmp/x")
    assert any(item.code == "destructive_filesystem" for item in rm.findings)

    shutdown = assess_command("shutdown -h now")
    assert any(item.code == "system_disruption" for item in shutdown.findings)

    curl = assess_command("curl -X POST https://example.com")
    assert any(item.code == "external_publish" for item in curl.findings)

    sudo = assess_command("sudo ls")
    assert any(item.code == "host_full_access" for item in sudo.findings)

    wrapped = assess_command("timeout 5 rm -rf /tmp/x")
    assert any(item.code == "destructive_filesystem" for item in wrapped.findings)

    copy = assess_command("cp a.txt b.txt")
    assert not {item.code for item in copy.findings} & NEVER_AUTO_APPROVED_CATEGORIES


def test_proxy_execution_is_host_full_access() -> None:
    for command in (
        "osascript -e 'return 1'",
        "osacompile -o /tmp/x.scpt /tmp/x.applescript",
        "launchctl list",
        "crontab -l",
        "at now",
        "defaults read com.apple.finder",
        "open -a Finder",
        "open README.md",
        "systemd-run --user echo hi",
        "schtasks /query",
        "timeout 5 osascript -e 'return 1'",
    ):
        verdict = assess_command(command)
        assert not verdict.is_contained, command
        assert any(item.code == "host_full_access" for item in verdict.findings), command


def test_command_risk_categories_cover_never_auto_approved() -> None:
    emitted = set(COMMAND_RISK_CATEGORIES.values())
    assert emitted >= NEVER_AUTO_APPROVED_CATEGORIES
