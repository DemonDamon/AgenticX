#!/usr/bin/env python3
"""``agx harness`` — session work-loop health review commands.

Author: Damon Li
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import typer

harness_app = typer.Typer(
    name="harness",
    help="Session work-loop health review (read-only by default).",
)


def _sessions_root() -> Path:
    return Path.home() / ".agenticx" / "sessions"


def _resolve_session_dir(session: str | None) -> Path | None:
    root = _sessions_root()
    if session:
        candidate = root / session
        return candidate if candidate.is_dir() else None
    if not root.is_dir():
        return None
    dirs = [d for d in root.iterdir() if d.is_dir()]
    if not dirs:
        return None
    return max(dirs, key=lambda d: d.stat().st_mtime)


@harness_app.command()
def review(
    session: str | None = typer.Option(
        None, "--session", "-s", help="Session id (default: most recently modified)."
    ),
    as_json: bool = typer.Option(False, "--json", help="Emit machine-readable JSON."),
    write: bool = typer.Option(False, "--write", help="Persist loop_review.json into the session dir."),
) -> None:
    """Review one session's work loop: five dimensions, evidence-capped scores."""
    from agenticx.learning.loop_review import (
        format_review_text,
        review_session,
        write_review,
    )

    session_dir = _resolve_session_dir(session)
    if session_dir is None:
        target = session or "<latest>"
        typer.echo(f"session not found: {target}", err=True)
        raise typer.Exit(code=1)

    result = review_session(session_dir)
    if write:
        write_review(result, session_dir)

    if as_json:
        typer.echo(json.dumps(dataclasses.asdict(result), ensure_ascii=False, indent=2))
    else:
        typer.echo(format_review_text(result))
