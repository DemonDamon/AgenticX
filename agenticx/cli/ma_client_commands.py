#!/usr/bin/env python3
"""``agx ma apply/get/sessions/tail`` against the public /ma/v1 API.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any, NoReturn, Optional

import typer
import yaml

from agenticx.managed.api_client import MAApiClient, MAApiError, MAEndpoints
from agenticx.managed.manifest import validate_manifest

APPLY_KEYS = frozenset(
    {
        "kind",
        "slug",
        "display_name",
        "description",
        "runtime",
        "assignment_keys",
        "worker_keys",
        "default_environment_id",
        "manifest",
        "note",
    }
)
_CREATE_KEYS = (
    "slug",
    "display_name",
    "description",
    "runtime",
    "assignment_keys",
    "worker_keys",
    "manifest",
    "note",
)
PATCHABLE_KEYS = (
    "display_name",
    "description",
    "runtime",
    "assignment_keys",
    "worker_keys",
    "default_environment_id",
)
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
_ULID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
_AGENT_HEADERS = ["SLUG", "ID", "LATEST", "EFFECTIVE", "LIFECYCLE", "STATUS"]
_VERSION_HEADERS = ["VERSION", "CREATED_AT", "HASH", "NOTE"]
_ENV_HEADERS = ["ID", "NAME", "TYPE", "STATUS"]
_SESSION_HEADERS = ["ID", "AGENT", "VERSION", "SOURCE", "STATUS", "STOP", "CREATED_AT"]

get_app = typer.Typer(
    name="get",
    help="Read agents, versions and environments",
    no_args_is_help=True,
)


def _token_option() -> Any:
    return typer.Option(
        ...,
        "--token",
        envvar="AGX_MA_TOKEN",
        show_default=False,
        help="Personal access token starting with agx-pat-",
    )


def _base_url_option() -> Any:
    return typer.Option(
        "http://127.0.0.1",
        "--base-url",
        envvar="AGX_MA_BASE_URL",
        help="Root used when control and runtime URLs are omitted",
    )


def _control_url_option() -> Any:
    return typer.Option(
        None,
        "--control-url",
        envvar="AGX_MA_CONTROL_URL",
        help=(
            "Control-plane root. Local admin API includes /api, "
            "for example http://127.0.0.1:3001/api"
        ),
    )


def _runtime_url_option() -> Any:
    return typer.Option(
        None,
        "--runtime-url",
        envvar="AGX_MA_RUNTIME_URL",
        help="Session-plane root, for example http://127.0.0.1:8092",
    )


def _die(message: str, code: int) -> NoReturn:
    typer.echo(message, err=True)
    raise typer.Exit(code)


def _blank(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _fail_api(exc: MAApiError) -> NoReturn:
    typer.echo(f"error: {exc.code}: {exc.message}", err=True)
    if exc.code == "manifest_invalid" and isinstance(exc.details, dict):
        errors = exc.details.get("errors")
        if isinstance(errors, list):
            for item in errors:
                typer.echo(str(item), err=True)
    raise typer.Exit(1)


def _open_client(
    base_url: str,
    control_url: str | None,
    runtime_url: str | None,
    token: str,
) -> MAApiClient:
    if not token.startswith("agx-pat-"):
        _die(
            "error: invalid_token: token must be an agx-pat- personal access token",
            2,
        )
    try:
        endpoints = MAEndpoints.resolve(base_url, _blank(control_url), _blank(runtime_url))
        return MAApiClient(endpoints, token)
    except MAApiError as exc:
        if exc.code == "invalid_token":
            _die(
                "error: invalid_token: token must be an agx-pat- personal access token",
                2,
            )
        raise


def _run(client: MAApiClient, action: Callable[[], None]) -> None:
    try:
        action()
    except MAApiError as exc:
        _fail_api(exc)
    finally:
        client.close()


def _load_apply(path: Path) -> dict[str, Any]:
    try:
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError):
        _die(f"error: {path}: cannot read", 2)
    if not isinstance(loaded, dict):
        _die("error: apply file must be a mapping", 2)
    for key in loaded:
        if key not in APPLY_KEYS:
            _die(f'error: unknown key "{key}"', 2)
    if loaded.get("kind") != "agent":
        _die('error: kind must be "agent"', 2)
    slug = loaded.get("slug")
    if not isinstance(slug, str) or _SLUG_RE.fullmatch(slug) is None:
        _die("error: slug is invalid", 2)
    display_name = loaded.get("display_name")
    if not isinstance(display_name, str) or not display_name.strip():
        _die("error: display_name is required", 2)
    result = validate_manifest(loaded.get("manifest"))
    if not result.ok:
        for line in result.errors:
            typer.echo(line, err=True)
        raise typer.Exit(2)
    return loaded


def _note(spec: dict[str, Any]) -> str | None:
    if "note" not in spec:
        return None
    note = spec["note"]
    if isinstance(note, str):
        return note
    return None


def _apply(client: MAApiClient, spec: dict[str, Any], *, publish: bool, dry_run: bool) -> None:
    slug = str(spec["slug"])
    found = client.find_agent_by_slug(slug)
    if found is None:
        if dry_run:
            typer.echo(f"would create agent {slug}")
            return
        body = {key: spec[key] for key in _CREATE_KEYS if key in spec}
        created = client.create_agent(body)
        agent = created["agent"]
        agent_id = str(agent["id"])
        version_no = created["version"]["version"]
        if spec.get("default_environment_id") is not None:
            updated = client.update_agent(
                agent_id,
                {"default_environment_id": spec["default_environment_id"]},
            )
            agent = updated["agent"]
        typer.echo(f"created agent {slug} ({agent_id}) version {version_no}")
    else:
        agent = found["agent"]
        agent_id = str(agent["id"])
        if dry_run:
            latest = agent["latest_version"]
            typer.echo(f"would update agent {slug} ({agent_id}) from version {latest}")
            return
        patch = {
            key: spec[key]
            for key in PATCHABLE_KEYS
            if key in spec and spec[key] != agent.get(key)
        }
        if patch:
            agent = client.update_agent(agent_id, patch)["agent"]
        version_record: dict[str, Any] | None = None
        created_flag = False
        for attempt in (1, 2):
            try:
                version_record, created_flag = client.create_version(
                    agent_id,
                    manifest=spec["manifest"],
                    expected_latest_version=agent["latest_version"],
                    note=_note(spec),
                )
                break
            except MAApiError as exc:
                if exc.code != "agent_version_conflict" or attempt == 2:
                    raise
                agent = client.get_agent(agent_id)["agent"]
        if version_record is None:
            raise MAApiError(0, "invalid_response", "invalid response")
        word = "updated" if created_flag else "unchanged"
        version_no = version_record["version"]
        typer.echo(f"{word} agent {slug} ({agent_id}) version {version_no}")
    if publish and agent.get("lifecycle") != "published":
        client.update_agent(agent_id, {"lifecycle": "published"})
        typer.echo(f"published agent {slug}")


def _resolve(client: MAApiClient, ref: str) -> dict[str, Any]:
    if _ULID_RE.fullmatch(ref):
        return client.get_agent(ref)
    found = client.find_agent_by_slug(ref)
    if found is None:
        _die(f'error: agent_not_found: agent "{ref}" not found', 1)
    return found


def _print_json(payload: Any) -> None:
    typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))


def _print_table(headers: list[str], rows: list[list[str]]) -> None:
    widths = [len(header) for header in headers]
    for row in rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))

    def render(cells: list[str]) -> str:
        padded = [cell.ljust(widths[index]) for index, cell in enumerate(cells)]
        return "  ".join(padded).rstrip()

    typer.echo(render(headers))
    for row in rows:
        typer.echo(render(row))


def _cell(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _agent_table(envelopes: list[dict[str, Any]]) -> None:
    rows: list[list[str]] = []
    for item in envelopes:
        agent = item.get("agent") if isinstance(item.get("agent"), dict) else {}
        routing = item.get("routing") if isinstance(item.get("routing"), dict) else {}
        rows.append(
            [
                _cell(agent.get("slug")),
                _cell(agent.get("id")),
                _cell(agent.get("latest_version")),
                _cell(routing.get("effective_version")),
                _cell(agent.get("lifecycle")),
                _cell(agent.get("status")),
            ]
        )
    _print_table(_AGENT_HEADERS, rows)


def _clip(text: str) -> str:
    flat = text.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    return flat[:200]


def _message_text(event: dict[str, Any]) -> str:
    content = event.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text" and isinstance(block.get("text"), str):
            parts.append(block["text"])
    return " ".join(parts)


def _event_summary(event: dict[str, Any]) -> str:
    event_type = event.get("type")
    if not isinstance(event_type, str):
        return ""
    if event_type == "agent.message":
        return _clip(_message_text(event))
    if event_type.startswith("agent.") and event_type.endswith("tool_use"):
        name = event.get("name")
        return name if isinstance(name, str) else ""
    if event_type == "session.status_idle":
        stop = event.get("stop_reason")
        if isinstance(stop, dict) and isinstance(stop.get("type"), str):
            return str(stop["type"])
        return ""
    if event_type == "session.error":
        error = event.get("error")
        if not isinstance(error, dict):
            return ""
        err_type = error.get("type") if isinstance(error.get("type"), str) else ""
        message = error.get("message") if isinstance(error.get("message"), str) else ""
        return _clip(f"{err_type}: {message}")
    return ""


def _stop_type(record: dict[str, Any]) -> str:
    reason = record.get("stop_reason")
    if isinstance(reason, dict) and isinstance(reason.get("type"), str) and reason["type"]:
        return str(reason["type"])
    return "-"


def apply(
    spec_file: Path = typer.Option(..., "--file", "-f"),
    publish: bool = typer.Option(False, "--publish"),
    dry_run: bool = typer.Option(False, "--dry-run"),
    base_url: str = _base_url_option(),
    control_url: Optional[str] = _control_url_option(),
    runtime_url: Optional[str] = _runtime_url_option(),
    token: str = _token_option(),
) -> None:
    """Create or update an agent from a YAML file and print the version."""
    spec = _load_apply(spec_file)
    client = _open_client(base_url, control_url, runtime_url, token)
    _run(client, lambda: _apply(client, spec, publish=publish, dry_run=dry_run))


@get_app.command("agents")
def get_agents(
    as_json: bool = typer.Option(False, "--json"),
    base_url: str = _base_url_option(),
    control_url: Optional[str] = _control_url_option(),
    runtime_url: Optional[str] = _runtime_url_option(),
    token: str = _token_option(),
) -> None:
    """List agents."""
    client = _open_client(base_url, control_url, runtime_url, token)

    def action() -> None:
        envelopes = client.list_agents()
        if as_json:
            _print_json(envelopes)
            return
        _agent_table(envelopes)

    _run(client, action)


@get_app.command("agent")
def get_agent(
    ref: str = typer.Argument(..., metavar="REF"),
    as_json: bool = typer.Option(False, "--json"),
    base_url: str = _base_url_option(),
    control_url: Optional[str] = _control_url_option(),
    runtime_url: Optional[str] = _runtime_url_option(),
    token: str = _token_option(),
) -> None:
    """Print one agent envelope. REF is a slug or ULID."""
    client = _open_client(base_url, control_url, runtime_url, token)

    def action() -> None:
        envelope = _resolve(client, ref)
        if as_json:
            _print_json(envelope)
            return
        _print_json(envelope)

    _run(client, action)


@get_app.command("versions")
def get_versions(
    ref: str = typer.Argument(..., metavar="REF"),
    limit: int = typer.Option(20, "--limit"),
    base_url: str = _base_url_option(),
    control_url: Optional[str] = _control_url_option(),
    runtime_url: Optional[str] = _runtime_url_option(),
    token: str = _token_option(),
) -> None:
    """List versions of an agent."""
    client = _open_client(base_url, control_url, runtime_url, token)

    def action() -> None:
        agent_id = str(_resolve(client, ref)["agent"]["id"])
        versions = client.list_versions(agent_id, limit=limit)
        rows = [
            [
                _cell(item.get("version")),
                _cell(item.get("created_at")),
                _cell(item.get("manifest_hash")),
                item.get("note") if isinstance(item.get("note"), str) else "",
            ]
            for item in versions
        ]
        _print_table(_VERSION_HEADERS, rows)

    _run(client, action)


@get_app.command("version")
def get_version(
    ref: str = typer.Argument(..., metavar="REF"),
    version: int = typer.Argument(..., metavar="N"),
    base_url: str = _base_url_option(),
    control_url: Optional[str] = _control_url_option(),
    runtime_url: Optional[str] = _runtime_url_option(),
    token: str = _token_option(),
) -> None:
    """Print one agent version, including its manifest."""
    client = _open_client(base_url, control_url, runtime_url, token)

    def action() -> None:
        agent_id = str(_resolve(client, ref)["agent"]["id"])
        _print_json(client.get_version(agent_id, version))

    _run(client, action)


@get_app.command("environments")
def get_environments(
    as_json: bool = typer.Option(False, "--json"),
    base_url: str = _base_url_option(),
    control_url: Optional[str] = _control_url_option(),
    runtime_url: Optional[str] = _runtime_url_option(),
    token: str = _token_option(),
) -> None:
    """List environments."""
    client = _open_client(base_url, control_url, runtime_url, token)

    def action() -> None:
        rows_raw = client.list_environments()
        if as_json:
            _print_json(rows_raw)
            return
        rows = [
            [
                _cell(item.get("id")),
                _cell(item.get("name")),
                _cell(item.get("type")),
                _cell(item.get("status")),
            ]
            for item in rows_raw
        ]
        _print_table(_ENV_HEADERS, rows)

    _run(client, action)


def sessions(
    agent: Optional[str] = typer.Option(None, "--agent", metavar="REF"),
    limit: int = typer.Option(20, "--limit"),
    all_users: bool = typer.Option(False, "--all", help="List the whole tenant (ma:admin)"),
    as_json: bool = typer.Option(False, "--json"),
    base_url: str = _base_url_option(),
    control_url: Optional[str] = _control_url_option(),
    runtime_url: Optional[str] = _runtime_url_option(),
    token: str = _token_option(),
) -> None:
    """List sessions. Defaults to sessions created by the caller."""
    client = _open_client(base_url, control_url, runtime_url, token)

    def action() -> None:
        agent_id = None
        if agent:
            agent_id = str(_resolve(client, agent)["agent"]["id"])
        records = client.list_sessions(
            agent_id=agent_id,
            limit=limit,
            scope="tenant" if all_users else "mine",
        )
        if as_json:
            _print_json(records)
            return
        rows = [
            [
                _cell(item.get("id")),
                _cell(item.get("agent_id")),
                _cell(item.get("agent_version")),
                _cell(item.get("source")),
                _cell(item.get("status")),
                _stop_type(item),
                _cell(item.get("created_at")),
            ]
            for item in records
        ]
        _print_table(_SESSION_HEADERS, rows)

    _run(client, action)


def tail(
    session_id: str = typer.Argument(..., metavar="SESSION_ID"),
    after_seq: int = typer.Option(0, "--after-seq"),
    until_idle: bool = typer.Option(False, "--until-idle"),
    as_json: bool = typer.Option(False, "--json"),
    base_url: str = _base_url_option(),
    control_url: Optional[str] = _control_url_option(),
    runtime_url: Optional[str] = _runtime_url_option(),
    token: str = _token_option(),
) -> None:
    """Follow a session event stream. Ctrl-C exits 130."""
    client = _open_client(base_url, control_url, runtime_url, token)

    def action() -> None:
        try:
            events = client.iter_events(
                session_id,
                after_seq=after_seq,
                until_idle=until_idle,
            )
            for event in events:
                if as_json:
                    typer.echo(json.dumps(event, ensure_ascii=False))
                    continue
                seq = event.get("seq")
                seq_text = f"{seq:>5}" if isinstance(seq, int) else f"{seq!s:>5}"
                event_type = event.get("type")
                type_text = event_type if isinstance(event_type, str) else ""
                typer.echo(f"{seq_text} {type_text} {_event_summary(event)}")
        except KeyboardInterrupt:
            raise typer.Exit(130) from None

    _run(client, action)


def register_client_commands(ma_app: typer.Typer) -> None:
    """Attach apply/get/sessions/tail onto the ``agx ma`` group."""
    ma_app.command("apply")(apply)
    ma_app.add_typer(get_app)
    ma_app.command("sessions")(sessions)
    ma_app.command("tail")(tail)
