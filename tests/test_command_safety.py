#!/usr/bin/env python3
"""Segment-by-segment command risk: contained vs approval vs opaque.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.command_safety import (
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
