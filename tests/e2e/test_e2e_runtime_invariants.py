#!/usr/bin/env python3
"""End-to-end acceptance for the runtime-invariants series.

Unlike the unit suites, every test here drives a **real** ``agx serve``
process over HTTP/SSE, kills it with SIGKILL, restarts it on the same data
root, and inspects the on-disk artifacts the runtime is supposed to own
(sessions, replay ledger, safety sink). No LLM is involved: sessions are
bound to the ``opencode`` harness whose executable is replaced by a stub
script that speaks the same NDJSON protocol.

Covered closed-loop criteria (master plan ``## Verification``):

  1. 续读 — a completed turn survives a process kill; two clients read the
     same history afterwards.
  2. 恢复 — a turn killed mid-flight leaves an incomplete ledger run and a
     history that is still consistent after restart (single-node; the HA
     replica hand-over is covered by ``tests/test_ha_checkpoint_resume.py``).
  4. 事件出口 — an external-CLI turn lands in the ledger as structured
     events, readable from disk after restart.
  5. 档位 — a bundle whose skill declares a tier it does not measure is
     rejected with zero bytes landed; a tampered skill is not served; the
     audit trail survives restart.

# Criterion 3 (dispatch wake after restart) is exercised by
# ``tests/test_dispatch_wake_after_restart.py``: it restarts the manager over
# a persisted dispatch record, which is the same code path the server uses
# on boot; there is no HTTP surface that can inject a suspended worker.
# ``test_dispatch_wake_across_processes`` below goes one step further and
# splits spawn and wake across two real processes sharing one data root.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

import httpx
import pytest

pytestmark = pytest.mark.skipif(
    os.name == "nt", reason="SIGKILL-based restart acceptance is POSIX only"
)

REPO_ROOT = Path(__file__).resolve().parents[2]
HEAVY_FILE_COUNT = 11  # > HEAVY_CODE_FILES (10, guard_classify.py:18)

TOKEN = "e2e-desktop-token"
TOKEN_HEADER = {"x-agx-desktop-token": TOKEN}

STUB_CLI = """#!/usr/bin/env python3
import json, os, sys, time

delay = float(os.environ.get("E2E_STUB_SLEEP", "0") or 0)
marker = os.environ.get("E2E_STUB_MARKER", "")
if marker:
    with open(marker, "a", encoding="utf-8") as fh:
        fh.write("turn\\n")
if delay:
    time.sleep(delay)

print(json.dumps({"type": "text",
                  "part": {"text": "E2E-HARNESS-OK"},
                  "sessionID": "ses-e2e"}), flush=True)
print(json.dumps({"type": "step_finish",
                  "part": {"reason": "stop",
                           "tokens": {"input": 1, "output": 1}}}), flush=True)
"""


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class StudioServer:
    """A real ``agx serve`` subprocess on an isolated HOME/data root."""

    def __init__(self, home: Path) -> None:
        self.home = home
        self.port = _free_port()
        self.proc: Optional[subprocess.Popen] = None
        self._log = open(home / "server.log", "ab")

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def _env(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(self.home),
            "AGX_HOME": str(self.home / ".agenticx"),
            "AGX_DESKTOP_TOKEN": TOKEN,
            "AGX_SKILL_PROFILE_GATE": "1",
            "PYTHONUNBUFFERED": "1",
            "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        }
        if extra:
            env.update(extra)
        return env

    def start(self, extra_env: Optional[Dict[str, str]] = None) -> None:
        self.proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "agenticx.cli.main",
                "serve",
                "--host",
                "127.0.0.1",
                "--port",
                str(self.port),
                "--token",
                TOKEN,
            ],
            cwd=str(REPO_ROOT),
            env=self._env(extra_env),
            stdout=self._log,
            stderr=subprocess.STDOUT,
        )
        self.wait_ready()

    def wait_ready(self, timeout: float = 90.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.proc is not None and self.proc.poll() is not None:
                raise RuntimeError(
                    "server exited during boot; see "
                    f"{(self.home / 'server.log').read_text(errors='replace')[-4000:]}"
                )
            try:
                resp = httpx.get(f"{self.base_url}/api/health", timeout=2.0)
                if resp.status_code == 200:
                    return
            except Exception:
                pass
            time.sleep(0.3)
        raise TimeoutError("server did not become healthy in time")

    def kill(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait(timeout=20)
        self.proc = None

    def restart(self, extra_env: Optional[Dict[str, str]] = None) -> None:
        self.kill()
        time.sleep(0.5)
        self.start(extra_env)

    def close(self) -> None:
        self.kill()
        self._log.close()

    def client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self.base_url, headers=TOKEN_HEADER, timeout=60.0
        )


@pytest.fixture()
def workspace(tmp_path: Path) -> Iterator[Dict[str, Any]]:
    home = tmp_path / "home"
    home.mkdir()
    ws = tmp_path / "workspace"
    ws.mkdir()
    stub = tmp_path / "bin" / "opencode"
    stub.parent.mkdir()
    stub.write_text(STUB_CLI, encoding="utf-8")
    stub.chmod(0o755)
    marker = tmp_path / "stub-turns.txt"
    server = StudioServer(home)
    server.start(
        {
            "AGX_OPENCODE_EXECUTABLE": str(stub),
            "E2E_STUB_MARKER": str(marker),
        }
    )
    try:
        yield {
            "home": home,
            "ws": ws,
            "stub": stub,
            "marker": marker,
            "server": server,
            "tmp": tmp_path,
        }
    finally:
        server.close()


def _create_harness_session(client: httpx.Client, workspace_dir: Path) -> str:
    resp = client.post(
        "/api/sessions",
        json={"name": "e2e-harness", "workspace_dir": str(workspace_dir)},
    )
    resp.raise_for_status()
    sid = resp.json()["session_id"]
    bound = client.post(f"/api/sessions/{sid}/harness", json={"harness_id": "opencode"})
    bound.raise_for_status()
    assert bound.json()["harness_id"] == "opencode"
    return sid


def _chat(client: httpx.Client, session_id: str, text: str) -> str:
    """POST /api/chat and drain the SSE stream; returns the raw stream text."""
    chunks: List[str] = []
    payload = {"session_id": session_id, "user_input": text}
    with client.stream("POST", "/api/chat", json=payload) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if line:
                chunks.append(line)
    return "\n".join(chunks)


def _messages(client: httpx.Client, session_id: str) -> List[Dict[str, Any]]:
    resp = client.get("/api/session/messages", params={"session_id": session_id})
    resp.raise_for_status()
    return resp.json()["messages"]


def _events_text(messages: List[Dict[str, Any]]) -> str:
    return json.dumps(messages, ensure_ascii=False)


def _ledger_runs(home: Path) -> List[Path]:
    root = home / ".agenticx" / "sessions"
    if not root.is_dir():
        return []
    return sorted(p for p in root.glob("*/runs/*") if p.is_dir())


def _run_json(run_dir: Path) -> Dict[str, Any]:
    path = run_dir / "run.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _run_events(run_dir: Path) -> List[Dict[str, Any]]:
    path = run_dir / "events.jsonl"
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.append(json.loads(line))
    return out


def _gate_records(home: Path) -> List[Dict[str, Any]]:
    path = home / ".agenticx" / "safety" / "extension_gate.jsonl"
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


# ----------------------------------------------------------------------
# criterion 1: history survives a process kill; two clients agree
# ----------------------------------------------------------------------
def test_history_survives_kill_and_two_clients_agree(workspace: Dict[str, Any]) -> None:
    server: StudioServer = workspace["server"]
    with server.client() as client:
        sid = _create_harness_session(client, workspace["ws"])

        stream = _chat(client, sid, "hello-before-kill")
        assert "E2E-HARNESS-OK" in stream

        before = _messages(client, sid)
        assert "hello-before-kill" in _events_text(before)

    server.restart(
        {
            "AGX_OPENCODE_EXECUTABLE": str(workspace["stub"]),
            "E2E_STUB_MARKER": str(workspace["marker"]),
        }
    )

    with server.client() as a, server.client() as b:
        after_a = _messages(a, sid)
        after_b = _messages(b, sid)
    assert after_a == after_b, "two clients must observe the same history"
    assert _events_text(after_a) == _events_text(before) or (
        json.dumps(after_a, sort_keys=True, ensure_ascii=False)
        == json.dumps(before, sort_keys=True, ensure_ascii=False)
    )

    # The session must still be usable after the restart.
    with server.client() as client:
        assert "E2E-HARNESS-OK" in _chat(client, sid, "hello-after-restart")


# ----------------------------------------------------------------------
# criterion 4: an external-CLI turn lands in the ledger, durably
# ----------------------------------------------------------------------
def test_external_harness_turn_lands_in_ledger(workspace: Dict[str, Any]) -> None:
    server: StudioServer = workspace["server"]
    home: Path = workspace["home"]
    with server.client() as client:
        sid = _create_harness_session(client, workspace["ws"])
        assert "E2E-HARNESS-OK" in _chat(client, sid, "record-me")

    runs = [r for r in _ledger_runs(home) if r.parent.parent.name.endswith(":harness")]
    assert runs, "expected a harness ledger run on disk"
    run = runs[-1]
    record = _run_json(run)
    events = _run_events(run)
    assert record.get("status") == "completed", record
    types = [str(e.get("type")) for e in events]
    assert "assistant_output_completed" in types, types
    seqs = [int(e.get("seq") or 0) for e in events]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    assert all(int(e.get("schema_version") or 0) >= 1 for e in events), events[:1]

    # Durable: a new process (restart) still reads the same run from disk.
    snapshot = [(e.get("event_id"), e.get("seq")) for e in events]
    server.restart(
        {
            "AGX_OPENCODE_EXECUTABLE": str(workspace["stub"]),
            "E2E_STUB_MARKER": str(workspace["marker"]),
        }
    )
    assert _run_json(run).get("status") == "completed"
    assert [(e.get("event_id"), e.get("seq")) for e in _run_events(run)] == snapshot


# ----------------------------------------------------------------------
# criterion 2 (single node): a killed turn leaves a resumable ledger run
# ----------------------------------------------------------------------
def test_midturn_kill_leaves_incomplete_run_and_intact_history(
    workspace: Dict[str, Any],
) -> None:
    server: StudioServer = workspace["server"]
    home: Path = workspace["home"]
    with server.client() as client:
        sid = _create_harness_session(client, workspace["ws"])
        assert "E2E-HARNESS-OK" in _chat(client, sid, "completed-turn")

    # Second turn: the stub sleeps, we SIGKILL the server mid-flight.
    runs_before = set(_ledger_runs(home))
    server.restart(
        {
            "AGX_OPENCODE_EXECUTABLE": str(workspace["stub"]),
            "E2E_STUB_MARKER": str(workspace["marker"]),
            "E2E_STUB_SLEEP": "30",
        }
    )
    def _run_turn() -> None:
        try:
            with server.client() as client:
                _chat(client, sid, "killed-turn")
        except Exception:  # connection dies with the kill
            pass

    thread = threading.Thread(target=_run_turn, daemon=True)
    thread.start()

    # Wait until the ledger run created *by this turn* exists on disk.
    new_runs: List[Path] = []
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        new_runs = sorted(set(_ledger_runs(home)) - runs_before)
        if new_runs:
            break
        time.sleep(0.2)
    assert new_runs, "the killed turn must have created its ledger run"
    killed = new_runs[-1]
    server.kill()
    thread.join(timeout=20)
    record = _run_json(killed)
    events = _run_events(killed)
    assert record.get("status") != "completed", record
    assert not any(
        str(e.get("type")) == "assistant_output_completed" for e in events
    ), "an unfinished turn must not record a completed output"

    server.start(
        {
            "AGX_OPENCODE_EXECUTABLE": str(workspace["stub"]),
            "E2E_STUB_MARKER": str(workspace["marker"]),
        }
    )
    with server.client() as client:
        messages = _messages(client, sid)
        text = _events_text(messages)
        assert "completed-turn" in text, "history before the kill must survive"
        # Recovery projection is served normally: no trap, no replay.
        assert "E2E-HARNESS-OK" in _chat(client, sid, "after-recovery")


# ----------------------------------------------------------------------
# criterion 3: dispatch wake across two real processes (a real restart)
# ----------------------------------------------------------------------
_SPAWN_CHILD = r"""
import asyncio, json
from agenticx.cli.studio import StudioSession
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.subagent_runs import dispatch as dispatch_store
from agenticx.runtime.team_manager import AgentTeamManager

OWNER = "sess-e2e-dispatch"


class _Resp:
    def __init__(self, content):
        self.content = content
        self.tool_calls = []


class _LLM:
    def invoke(self, *a, **k):
        return _Resp("worker-reply")

    def stream(self, *a, **k):
        yield "worker-reply"


def _state(run_id):
    return dispatch_store.dispatch_of(SubAgentRunStore(OWNER).get_run(run_id)).get("state")


async def main():
    manager = AgentTeamManager(
        llm_factory=lambda: _LLM(),
        base_session=StudioSession(),
        owner_session_id=OWNER,
    )
    spawned = await manager.spawn_subagent(name="worker-a", role="worker", task="write a note")
    run_id = spawned["agent_id"]
    for _ in range(200):
        if _state(run_id) == dispatch_store.DISPATCH_STATE_WAITING:
            break
        await asyncio.sleep(0.05)
    print(json.dumps({"run_id": run_id, "state": _state(run_id)}))


asyncio.run(main())
"""

_WAKE_CHILD = r"""
import asyncio, json, os
from agenticx.cli.studio import StudioSession
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.subagent_runs import dispatch as dispatch_store
from agenticx.runtime.team_manager import AgentTeamManager

OWNER = "sess-e2e-dispatch"
RUN_ID = os.environ["E2E_RUN_ID"]
MAIL = "continue: write the second note"
COUNTER = os.environ["E2E_LLM_COUNTER"]


class _Resp:
    def __init__(self, content):
        self.content = content
        self.tool_calls = []


class _LLM:
    def invoke(self, *a, **k):
        with open(COUNTER, "a", encoding="utf-8") as fh:
            fh.write("call\n")
        return _Resp("woken-reply")

    def stream(self, *a, **k):
        with open(COUNTER, "a", encoding="utf-8") as fh:
            fh.write("call\n")
        yield "woken-reply"


async def main():
    manager = AgentTeamManager(
        llm_factory=lambda: _LLM(),
        base_session=StudioSession(),
        owner_session_id=OWNER,
    )
    first = await manager.send_message_to_subagent(RUN_ID, MAIL, message_id="mail-1")
    for _ in range(200):
        state = dispatch_store.dispatch_of(SubAgentRunStore(OWNER).get_run(RUN_ID))
        if state.get("state") == dispatch_store.DISPATCH_STATE_WAITING:
            break
        await asyncio.sleep(0.05)
    duplicate = await manager.send_message_to_subagent(RUN_ID, MAIL, message_id="mail-1")
    calls = 0
    if os.path.isfile(COUNTER):
        calls = len([ln for ln in open(COUNTER, encoding="utf-8").read().splitlines() if ln])
    mails = dispatch_store.read_mailbox(SubAgentRunStore(OWNER), RUN_ID)
    snapshot = dispatch_store.read_context_snapshot(SubAgentRunStore(OWNER), RUN_ID) or {}
    print(json.dumps({
        "first": first,
        "duplicate": duplicate,
        "calls": calls,
        "mails": [{"message_id": m["message_id"], "consumed_by": m.get("consumed_by")} for m in mails],
        "snapshot": snapshot,
    }, ensure_ascii=False))


asyncio.run(main())
"""


def _run_child(script: str, home: Path, tmp: Path, extra_env: Dict[str, str]) -> str:
    path = tmp / f"child_{abs(hash(script)) % 100000}.py"
    path.write_text(script, encoding="utf-8")
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(home),
        "AGX_HOME": str(home / ".agenticx"),
        "PYTHONUNBUFFERED": "1",
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
    }
    env.update(extra_env)
    proc = subprocess.run(
        [sys.executable, str(path)],
        cwd=str(REPO_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr[-4000:]
    return proc.stdout


def test_dispatch_wake_across_processes(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    counter = tmp_path / "llm-calls.txt"

    spawned = json.loads(_run_child(_SPAWN_CHILD, home, tmp_path, {}).strip().splitlines()[-1])
    assert spawned["state"] == "waiting", spawned
    run_id = spawned["run_id"]

    woken = json.loads(
        _run_child(
            _WAKE_CHILD,
            home,
            tmp_path,
            {"E2E_RUN_ID": run_id, "E2E_LLM_COUNTER": str(counter)},
        ).strip().splitlines()[-1]
    )

    # Woken by a *different* process than the one that suspended the worker.
    assert woken["first"]["ok"] is True
    assert woken["first"].get("restored") is True
    # Exactly once: the duplicate reuses the mailbox entry and never re-runs.
    assert woken["duplicate"].get("duplicate") is True
    assert [m["message_id"] for m in woken["mails"]] == ["mail-1"]
    assert woken["mails"][0]["consumed_by"] == "wake_turn"
    assert woken["calls"] >= 1
    rows = woken["snapshot"].get("agent_messages") or []
    assert any(row.get("role") == "user" and "continue: write the second note" in str(row.get("content")) for row in rows)
    assert "worker-reply" in json.dumps(rows, ensure_ascii=False)


# ----------------------------------------------------------------------
# criterion 5: tier mismatch rejected, zero landing, audit survives restart
# ----------------------------------------------------------------------
def _make_bundle(root: Path, name: str, *, declared: Optional[str], heavy: bool) -> Path:
    bdir = root / name
    skill = bdir / "skills" / "demo-skill"
    skill.mkdir(parents=True)
    tier_line = f"tier: {declared}" if declared else ""
    (skill / "SKILL.md").write_text(
        "---\n"
        "name: demo-skill\n"
        "description: e2e bundle skill\n"
        f"{tier_line}\n"
        "---\n\n# demo-skill\n\nPlain instructions only.\n",
        encoding="utf-8",
    )
    if heavy:
        for idx in range(HEAVY_FILE_COUNT):
            (skill / f"script_{idx}.py").write_text("x = 1\n", encoding="utf-8")
    (bdir / "agx-bundle.yaml").write_text(
        "agx_bundle: \"1.0\"\n"
        f"name: {name}\n"
        "version: \"1.0.0\"\n"
        "description: e2e\n"
        "components:\n"
        "  skills:\n"
        "    - path: skills/demo-skill/SKILL.md\n",
        encoding="utf-8",
    )
    return bdir


def test_bundle_tier_mismatch_rejected_and_audit_survives_restart(
    workspace: Dict[str, Any],
) -> None:
    server: StudioServer = workspace["server"]
    home: Path = workspace["home"]
    agx = home / ".agenticx"
    bad = _make_bundle(workspace["tmp"], "bad-bundle", declared="T-MD", heavy=True)

    with server.client() as client:
        resp = client.post("/api/bundles/install", json={"source_path": str(bad)})
        body = resp.json()

    assert body["ok"] is False
    assert body["error_code"] == "tier_mismatch"
    assert not (agx / "skills" / "bundles" / "bad-bundle").exists()
    assert not (agx / "bundles.json").exists()
    first = [r for r in _gate_records(home) if r["action"] == "BUNDLE_REJECTED"]
    assert first and first[0]["tool_name"] == "demo-skill"

    # Restart: the record is on disk, and the new process appends to the
    # same durable sink instead of starting a fresh in-memory trail.
    server.restart(
        {
            "AGX_OPENCODE_EXECUTABLE": str(workspace["stub"]),
            "E2E_STUB_MARKER": str(workspace["marker"]),
        }
    )
    assert _gate_records(home)[: len(first)] == first

    bad2 = _make_bundle(workspace["tmp"], "bad-bundle-2", declared="T-MD", heavy=True)
    with server.client() as client:
        body2 = client.post(
            "/api/bundles/install", json={"source_path": str(bad2)}
        ).json()
    assert body2["ok"] is False and body2["error_code"] == "tier_mismatch"
    records = _gate_records(home)
    assert len([r for r in records if r["action"] == "BUNDLE_REJECTED"]) >= 2
    assert records[: len(first)] == first

    # A truthful bundle still installs (no over-blocking).
    good = _make_bundle(workspace["tmp"], "good-bundle", declared="T-MD", heavy=False)
    with server.client() as client:
        good_body = client.post(
            "/api/bundles/install", json={"source_path": str(good)}
        ).json()
    assert good_body["ok"] is True, good_body
    assert (agx / "skills" / "bundles" / "good-bundle" / "demo-skill" / "SKILL.md").is_file()


# ----------------------------------------------------------------------
# criterion 5 (load side): a tampered skill is never served
# ----------------------------------------------------------------------
def test_loader_denies_tampered_skill_over_http(workspace: Dict[str, Any]) -> None:
    server: StudioServer = workspace["server"]
    home: Path = workspace["home"]
    skill_dir = home / ".agenticx" / "skills" / "registry" / "tampered"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: tampered\ndescription: e2e\ntier: T-MD\n---\n\n# tampered\n",
        encoding="utf-8",
    )
    for idx in range(HEAVY_FILE_COUNT):
        (skill_dir / f"script_{idx}.py").write_text("x = 1\n", encoding="utf-8")

    with server.client() as client:
        client.post("/api/skills/refresh").raise_for_status()
        detail = client.get("/api/skills/tampered")
        listing = client.get("/api/skills")

    assert detail.status_code == 404, detail.text
    names = {str(item.get("name") or item.get("id") or "") for item in listing.json().get("skills", [])}
    assert "tampered" not in names
    assert any(r["action"] == "LOAD_DENIED" for r in _gate_records(home))
