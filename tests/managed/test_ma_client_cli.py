#!/usr/bin/env python3
"""``agx ma apply/get/sessions/tail`` against a mocked /ma/v1 client.

Author: Damon Li
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml
from typer.testing import CliRunner

from agenticx.cli import ma_client_commands
from agenticx.cli.main import app
from agenticx.managed.api_client import MAApiClient

_ROOT = Path(__file__).resolve().parents[2]
_EXAMPLE = _ROOT / "examples" / "managed" / "agent.apply.yaml"
_CASES = json.loads(
    (_ROOT / "tests" / "fixtures" / "managed_agents" / "client_cases.json").read_text(encoding="utf-8")
)
_AGENT_ID = "01JAGENT0000000000000000AA"
_TOKEN = "agx-pat-cli-test" # gitleaks:allow
Handler = Callable[[httpx.Request], httpx.Response]


def _spec() -> dict[str, Any]:
    loaded = yaml.safe_load(_EXAMPLE.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def _agent(spec: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    agent: dict[str, Any] = {
        "id": _AGENT_ID,
        "slug": spec["slug"],
        "display_name": spec["display_name"],
        "description": spec.get("description"),
        "latest_version": 2,
        "status": "active",
        "lifecycle": "draft",
        "runtime": spec.get("runtime"),
        "assignment_keys": spec.get("assignment_keys"),
        "worker_keys": spec.get("worker_keys"),
        "default_environment_id": spec.get("default_environment_id"),
    }
    agent.update(overrides)
    return agent


def _envelope(agent: dict[str, Any]) -> dict[str, Any]:
    return {
        "agent": agent,
        "routing": {
            "mode": "follow_latest",
            "pinned_version": None,
            "effective_version": agent["latest_version"],
        },
    }


def _body(request: httpx.Request) -> Any:
    if not request.content:
        return None
    return json.loads(request.content)


def _install(monkeypatch: pytest.MonkeyPatch, handler: Handler) -> list[httpx.Request]:
    calls: list[httpx.Request] = []
    real = MAApiClient

    def transport(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    def factory(
        endpoints: Any,
        token: str,
        *,
        http: httpx.Client | None = None,
        timeout: float = 30.0,
    ) -> MAApiClient:
        del http
        client = httpx.Client(transport=httpx.MockTransport(transport), trust_env=False)
        return real(endpoints, token, http=client, timeout=timeout)

    monkeypatch.setattr(ma_client_commands, "MAApiClient", factory)
    return calls


def _invoke(
    monkeypatch: pytest.MonkeyPatch,
    handler: Handler,
    args: list[str],
    *,
    token: str = _TOKEN,
) -> tuple[Any, list[httpx.Request]]:
    calls = _install(monkeypatch, handler)
    result = CliRunner(mix_stderr=False).invoke(
        app,
        ["ma", *args, "--token", token, "--base-url", "http://ma.test"],
    )
    return result, calls


def _created_agent() -> dict[str, Any]:
    return {
        "agent": {
            "id": _AGENT_ID,
            "slug": "report-bot",
            "lifecycle": "draft",
            "latest_version": 1,
            "status": "active",
        },
        "routing": {"mode": "follow_latest", "pinned_version": None, "effective_version": 1},
        "version": {"version": 1},
    }


def test_apply_creates_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    spec = _spec()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"data": []})
        return httpx.Response(201, json=_created_agent())

    result, calls = _invoke(monkeypatch, handler, ["apply", "-f", str(_EXAMPLE)])
    posts = [call for call in calls if call.method == "POST"]
    assert len(posts) == 1
    body = _body(posts[0])
    expected = {
        key: spec[key]
        for key in (
            "slug",
            "display_name",
            "description",
            "runtime",
            "assignment_keys",
            "worker_keys",
            "manifest",
            "note",
        )
        if key in spec
    }
    assert set(body) == set(expected)
    assert body == expected
    assert result.exit_code == 0
    assert result.stdout == f"created agent report-bot ({_AGENT_ID}) version 1\n"


def test_apply_updates_version(monkeypatch: pytest.MonkeyPatch) -> None:
    spec = _spec()
    agent = _agent(spec, description="old")
    patches: list[Any] = []
    versions: list[Any] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path.endswith("/agents"):
            return httpx.Response(200, json={"data": [_envelope(agent)]})
        if request.method == "PATCH":
            body = _body(request)
            patches.append(body)
            return httpx.Response(200, json=_envelope({**agent, **body}))
        if request.method == "POST":
            body = _body(request)
            versions.append(body)
            return httpx.Response(201, json=_CASES["version_created"])
        raise AssertionError(f"unexpected {request.method} {request.url}")

    result, _calls = _invoke(monkeypatch, handler, ["apply", "-f", str(_EXAMPLE)])
    assert patches == [{"description": spec["description"]}]
    assert versions[0]["expected_latest_version"] == 2
    assert result.exit_code == 0
    assert result.stdout == f"updated agent report-bot ({_AGENT_ID}) version 3\n"


def test_apply_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    agent = _agent(_spec())

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"data": [_envelope(agent)]})
        if request.method == "POST":
            return httpx.Response(200, json=_CASES["version_unchanged"])
        raise AssertionError(request.method)

    result, calls = _invoke(monkeypatch, handler, ["apply", "-f", str(_EXAMPLE)])
    assert all(call.method != "PATCH" for call in calls)
    assert result.exit_code == 0
    assert result.stdout == f"unchanged agent report-bot ({_AGENT_ID}) version 2\n"


def test_apply_retries_conflict_once(monkeypatch: pytest.MonkeyPatch) -> None:
    spec = _spec()
    agent = _agent(spec, description="old")
    attempts: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET" and path.endswith("/agents"):
            return httpx.Response(200, json={"data": [_envelope(agent)]})
        if request.method == "GET" and path.endswith(_AGENT_ID):
            return httpx.Response(200, json=_envelope({**agent, "latest_version": 3}))
        if request.method == "PATCH":
            body = _body(request)
            return httpx.Response(200, json=_envelope({**agent, **body}))
        if request.method == "POST":
            body = _body(request)
            attempts.append(body["expected_latest_version"])
            if len(attempts) == 1:
                return httpx.Response(409, json=_CASES["error_conflict"])
            return httpx.Response(200, json=_CASES["version_created"])
        raise AssertionError(request.method)

    result, _calls = _invoke(monkeypatch, handler, ["apply", "-f", str(_EXAMPLE)])
    assert attempts == [2, 3]
    assert result.exit_code == 0

    def always_conflict(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET" and path.endswith("/agents"):
            return httpx.Response(200, json={"data": [_envelope(agent)]})
        if request.method == "GET":
            return httpx.Response(200, json=_envelope({**agent, "latest_version": 3}))
        if request.method == "PATCH":
            return httpx.Response(200, json=_envelope(agent))
        return httpx.Response(409, json=_CASES["error_conflict"])

    failed, _ignored = _invoke(monkeypatch, always_conflict, ["apply", "-f", str(_EXAMPLE)])
    assert failed.exit_code == 1
    assert "error: agent_version_conflict:" in (failed.stderr or "")


def test_apply_rejects_unknown_key(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    path = tmp_path / "agent.yaml"
    path.write_text("kind: agent\nslug: report-bot\ndisplay_name: 报表助手\nfoo: 1\n", encoding="utf-8")

    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("unknown key must not call the API")

    result, calls = _invoke(monkeypatch, handler, ["apply", "-f", str(path)])
    assert result.exit_code == 2
    assert 'error: unknown key "foo"' in (result.stderr or "")
    assert calls == []


def test_apply_reports_manifest_errors(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    path = tmp_path / "agent.yaml"
    path.write_text(
        "kind: agent\nslug: report-bot\ndisplay_name: 报表助手\nmanifest:\n  model: openai/gpt-4o-mini\n",
        encoding="utf-8",
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("invalid manifest must not call the API")

    result, calls = _invoke(monkeypatch, handler, ["apply", "-f", str(path)])
    assert result.exit_code == 2
    assert "manifest.schema:" in (result.stderr or "")
    assert calls == []


def test_apply_dry_run(monkeypatch: pytest.MonkeyPatch) -> None:
    agent = _agent(_spec())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [_envelope(agent)]})

    result, calls = _invoke(monkeypatch, handler, ["apply", "-f", str(_EXAMPLE), "--dry-run"])
    assert result.exit_code == 0
    assert calls
    assert {call.method for call in calls} == {"GET"}
    assert result.stdout == f"would update agent report-bot ({_AGENT_ID}) from version 2\n"


def test_apply_publish(monkeypatch: pytest.MonkeyPatch) -> None:
    patches: list[Any] = []

    def create_handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"data": []})
        if request.method == "POST":
            return httpx.Response(201, json=_created_agent())
        body = _body(request)
        patches.append(body)
        published = {**_created_agent()["agent"], **body}
        return httpx.Response(200, json=_envelope(published))

    created, _calls = _invoke(
        monkeypatch,
        create_handler,
        ["apply", "-f", str(_EXAMPLE), "--publish"],
    )
    assert created.exit_code == 0, created.stderr
    assert created.stdout == (
        f"created agent report-bot ({_AGENT_ID}) version 1\n"
        "published agent report-bot\n"
    )
    assert patches == [{"lifecycle": "published"}]

    spec = _spec()
    published_agent = _agent(spec, lifecycle="published")
    later_patches: list[Any] = []

    def update_handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"data": [_envelope(published_agent)]})
        if request.method == "PATCH":
            later_patches.append(_body(request))
            return httpx.Response(200, json=_envelope(published_agent))
        return httpx.Response(201, json=_CASES["version_created"])

    updated, _calls = _invoke(
        monkeypatch,
        update_handler,
        ["apply", "-f", str(_EXAMPLE), "--publish"],
    )
    assert updated.exit_code == 0, updated.stderr
    assert later_patches == []
    assert "published agent" not in updated.stdout
    assert updated.stdout.startswith(f"updated agent report-bot ({_AGENT_ID}) version 3")


def test_get_agents_table(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_CASES["agents_list"])

    result, _calls = _invoke(monkeypatch, handler, ["get", "agents"])
    assert result.exit_code == 0
    header = result.stdout.splitlines()[0]
    assert header.split() == ["SLUG", "ID", "LATEST", "EFFECTIVE", "LIFECYCLE", "STATUS"]


def test_get_agent_by_slug(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_CASES["agents_list"])

    result, _calls = _invoke(monkeypatch, handler, ["get", "agent", "report-bot"])
    assert result.exit_code == 0
    assert '"slug": "report-bot"' in result.stdout


def test_sessions_all_uses_tenant_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["scope"] == "tenant"
        return httpx.Response(200, json={"data": []})

    result, calls = _invoke(monkeypatch, handler, ["sessions", "--all"])
    assert result.exit_code == 0
    assert calls[0].url.params["scope"] == "tenant"


def test_tail_until_idle(monkeypatch: pytest.MonkeyPatch) -> None:
    defaults = dict(MAApiClient.iter_events.__kwdefaults__ or {})
    defaults["sleep"] = lambda _delay: None
    monkeypatch.setattr(MAApiClient.iter_events, "__kwdefaults__", defaults)
    parts = [_CASES["stream_part1"], _CASES["stream_part2"]]
    state = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        text = parts[state["n"]]
        state["n"] += 1
        return httpx.Response(200, text=text)

    result, _calls = _invoke(monkeypatch, handler, ["tail", "S", "--until-idle"])
    assert result.exit_code == 0, result.stderr
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    assert len(lines) == 3
    assert lines[0].startswith("    2 session.status_running")
    assert "agent.message hello" in lines[1]
    assert "session.status_idle end_turn" in lines[2]


def test_invalid_token_exits_2() -> None:
    result = CliRunner(mix_stderr=False).invoke(app, ["ma", "get", "agents", "--token", "abc"])
    assert result.exit_code == 2
    assert "error: invalid_token: token must be an agx-pat- personal access token" in (result.stderr or "")


def test_errors_do_not_print_token(monkeypatch: pytest.MonkeyPatch) -> None:
    token = "agx-pat-do-not-leak" # gitleaks:allow

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={
                "error": {
                    "code": "unauthorized",
                    "message": "missing or invalid bearer token",
                    "details": {},
                }
            },
        )

    result, _calls = _invoke(monkeypatch, handler, ["get", "agents"], token=token)
    text = result.stdout + (result.stderr or "")
    assert result.exit_code == 1
    assert "error: unauthorized:" in (result.stderr or "")
    assert token not in text


def test_ma_help_lists_client_commands() -> None:
    result = CliRunner().invoke(app, ["ma", "--help"])
    assert result.exit_code == 0
    for name in ("apply", "get", "sessions", "tail", "serve", "worker"):
        assert name in result.stdout


def test_ma_client_commands_import_is_light() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys, agenticx.cli.ma_client_commands; "
                "assert 'agenticx.runtime.agent_runtime' not in sys.modules; "
                "assert 'agenticx.studio.server' not in sys.modules"
            ),
        ],
        cwd=_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
