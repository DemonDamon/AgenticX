#!/usr/bin/env python3
"""AgenticX security eval — red-team model safety scoring (SP2).

``agx security-eval run`` drives the attack corpus through a model
matrix and produces a versioned scorecard (md + json) usable as
presale evidence and as admin-console model-admission input.

Author: Damon Li
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

security_eval_app = typer.Typer(
    name="security-eval",
    help="Model security red-team evaluation & safety scorecard",
    no_args_is_help=True,
)
console = Console()


def _parse_model_ref(raw: str) -> tuple[str, str]:
    """Parse ``provider/model`` (bare model falls back to default provider)."""
    raw = raw.strip()
    if not raw:
        raise typer.BadParameter("empty --model value")
    if "/" in raw:
        provider, _, model = raw.partition("/")
        provider, model = provider.strip(), model.strip()
        if not provider or not model:
            raise typer.BadParameter(f"--model expects provider/model, got: {raw}")
        return provider, model
    from agenticx.cli.config_manager import ConfigManager

    default = str(ConfigManager.get_value("default_provider") or "").strip()
    if not default:
        raise typer.BadParameter(
            f"bare model '{raw}' needs a default_provider in ~/.agenticx/config.yaml "
            "or use the provider/model form"
        )
    return default, raw


def _run_id() -> str:
    from datetime import datetime

    return datetime.now().strftime("%Y%m%dT%H%M%SZ")


@security_eval_app.command("run")
def security_eval_run(
    models: list[str] = typer.Option(
        [],
        "--model",
        help="Target model as provider/model (repeatable), e.g. zhipu/glm-4.6",
    ),
    mock: bool = typer.Option(
        False, "--mock", help="Use the deterministic MockInvoker (no network, CI-safe)"
    ),
    mock_behavior: str = typer.Option(
        "compliant", "--mock-behavior", help="Mock behavior: compliant | refusing"
    ),
    output: Optional[Path] = typer.Option(
        None,
        "--output",
        help="Output directory for scorecard.md + scorecard.json "
        "(default: security-eval-reports/<run_id>)",
    ),
    max_attacks: Optional[int] = typer.Option(
        None, "--max-attacks", min=1, help="Cap the corpus size (quick runs)"
    ),
    timeout: float = typer.Option(
        60.0, "--timeout", min=5.0, help="Per-call LLM timeout in seconds"
    ),
) -> None:
    """Run the attack corpus against the model matrix and write the scorecard."""
    from agenticx.security_eval.corpus import build_corpus
    from agenticx.security_eval.report import write_reports
    from agenticx.security_eval.runner import (
        MockInvoker,
        ModelRef,
        resolve_provider_invoker,
        run_eval,
    )

    if not models and not mock:
        console.print(
            "[yellow]No --model given; nothing to evaluate. "
            "Pass --model provider/model (repeatable) or --mock.[/yellow]"
        )
        raise typer.Exit(1)
    if mock and models:
        console.print("[dim]--mock given: ignoring --model values, using mock model.[/dim]")

    corpus = build_corpus(max_attacks=max_attacks)
    cases: list = corpus["cases"]
    stale: list = corpus["stale_templates"]
    console.print(
        f"[bold]Corpus[/bold] {corpus['version']} · {len(cases)} attacks"
        + (f" · [yellow]{len(stale)} stale template(s): {', '.join(stale)}[/yellow]" if stale else "")
    )

    if mock:
        model_refs = [ModelRef(provider="mock", model="mock")]
        invoker = MockInvoker(behavior=mock_behavior)
    else:
        model_refs = [ModelRef(*_parse_model_ref(m)) for m in models]
        invoker = resolve_provider_invoker(timeout=timeout)

    run_id = _run_id()
    out_dir = Path(output) if output else Path("security-eval-reports") / run_id
    console.print(f"[bold]Run[/bold] {run_id} · models: {', '.join(r.key for r in model_refs)}")

    t0 = time.monotonic()

    def _progress(done: int, total: int, label: str) -> None:
        console.print(f"  [{done}/{total}] {label}", highlight=False)

    run = run_eval(
        run_id=run_id,
        models=model_refs,
        cases=cases,
        invoker=invoker,
        progress=_progress,
    )
    run.corpus = cases
    run.corpus_version = str(corpus["version"])
    run.stale_templates = stale
    wall = time.monotonic() - t0

    paths = write_reports(run, out_dir, wall_seconds=wall)

    table = Table(title=f"Security scorecard {run_id}")
    table.add_column("Model")
    table.add_column("Score", justify="right")
    table.add_column("Grade", justify="center")
    table.add_column("Refused", justify="right")
    table.add_column("Blocked", justify="right")
    table.add_column("Bypassed", justify="right")
    table.add_column("Errors", justify="right")
    for m in run.models:
        style = "green" if m.safety_score >= 80 else ("yellow" if m.safety_score >= 50 else "red")
        table.add_row(
            m.ref.key,
            f"[{style}]{m.safety_score}[/{style}]",
            f"[{style}]{m.grade}[/{style}]",
            str(m.count("refused")),
            str(m.count("blocked_by_rule")),
            str(m.count("bypassed")),
            str(m.count("error")),
        )
    console.print(table)
    console.print(
        f"[green]Scorecard written:[/green] {paths['json']} · {paths['markdown']}"
    )
    console.print(
        "[dim]Import scorecard.json via admin-console (POST /api/admin/security/scorecards) "
        "to enforce the model admission threshold.[/dim]"
    )


@security_eval_app.command("show")
def security_eval_show(
    run_dir: Path = typer.Argument(..., help="Directory containing scorecard.json"),
) -> None:
    """Display a previously generated scorecard."""
    from agenticx.security_eval.report import load_scorecard

    path = Path(run_dir) / "scorecard.json"
    try:
        card = load_scorecard(path)
    except FileNotFoundError:
        console.print(f"[red]No scorecard.json under {run_dir}[/red]")
        raise typer.Exit(1) from None
    except ValueError as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(1) from None

    console.print(f"[bold]Run[/bold] {card.get('run_id')} · {card.get('created_at')}")
    corpus = card.get("corpus") or {}
    console.print(f"[bold]Corpus[/bold] {corpus.get('version')} · {corpus.get('attacks')} attacks")
    table = Table(title="Models")
    table.add_column("Model")
    table.add_column("Score", justify="right")
    table.add_column("Grade", justify="center")
    table.add_column("Bypassed", justify="right")
    for m in card.get("models") or []:  # type: ignore[union-attr]
        if not isinstance(m, dict):
            continue
        table.add_row(
            f"{m.get('provider')}/{m.get('model')}",
            str(m.get("safety_score")),
            str(m.get("grade")),
            str(m.get("bypassed")),
        )
    console.print(table)
    md = Path(run_dir) / "scorecard.md"
    if md.is_file():
        console.print(f"[dim]Markdown card: {md}[/dim]")
