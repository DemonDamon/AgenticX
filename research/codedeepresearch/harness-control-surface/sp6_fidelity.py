#!/usr/bin/env python3
"""SP6 switching-fidelity evaluation (harness-control-surface master plan).

Per seed (3 seeds): one studio session runs a multi-step task across
4 mid-session switches (opencode -> codex -> opencode -> codex -> opencode)
on a REAL studio server with the REAL opencode LLM and the codex protocol
stub. Measures:

  1. context survival  - anchors recalled after switching back (N/3)
  2. task completion   - final instruction executed correctly (ordered keys
                         + task-state recall)
  3. handoff summary   - programmatic spot-check of the eight summary
                         fields across every recorded handoff (goal carries
                         task keywords; fields populated)

Usage: python sp6_fidelity.py <seed-index 0|1|2>   (one server per seed)
Writes /tmp/sp6_seed<i>.json + appends human-readable log to stdout.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time

import httpx

PORT = 19810
TOKEN = "sp6-fidelity-token"
BASE = f"http://127.0.0.1:{PORT}"
AUTH = {"x-agx-desktop-token": TOKEN}

SEEDS = [
    {
        "keys": ["ALPHA-7Q4", "BETA-9K2", "GAMMA-5D8"],
        "task": "payment reconciliation report",
        "sections": ["数据导入", "对账规则", "差异清单", "税额核对"],
    },
    {
        "keys": ["ORION-3X9", "LYRA-8M1", "VEGA-2T6"],
        "task": "supplier risk scoring model",
        "sections": ["特征工程", "评分卡", "回测", "监控面板"],
    },
    {
        "keys": ["NADIR-5C3", "ZENITH-7H8", "ECHO-4R2"],
        "task": "customer churn analysis deck",
        "sections": ["队列定义", "流失归因", "挽留实验", "汇报页"],
    },
]

SWITCH_COUNT = 4


def start_server(home: str) -> subprocess.Popen:
    env = dict(os.environ)
    env["HOME"] = home
    env["AGX_DESKTOP_TOKEN"] = TOKEN
    env["AGX_SERVE_PORT"] = str(PORT)
    env["AGX_CODEX_EXECUTABLE"] = "/tmp/fake_codex_e2e.py"
    env["FAKE_CODEX_LOG"] = os.path.join(home, "codex_stub_log.jsonl")
    env.pop("AGX_GATEWAY_ENABLED", None)
    proc = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "from agenticx.studio.server import create_studio_app; "
            "import uvicorn; uvicorn.run(create_studio_app(), "
            f"host='127.0.0.1', port={PORT}, log_level='warning')",
        ],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.time() + 90
    with httpx.Client(timeout=3.0, trust_env=False) as client:
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError("studio server exited during startup")
            try:
                if client.get(f"{BASE}/api/harnesses", headers=AUTH).status_code == 200:
                    return proc
            except httpx.ConnectError:
                pass
            time.sleep(0.5)
    raise RuntimeError("studio server did not become healthy in 90s")


def stop_server(proc: subprocess.Popen) -> None:
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=10)


def chat_sse(client: httpx.Client, sid: str, text: str) -> str:
    events: list[dict] = []
    with client.stream(
        "POST",
        f"{BASE}/api/chat",
        headers=AUTH,
        json={"session_id": sid, "user_input": text},
        timeout=300.0,
    ) as r:
        if r.status_code != 200:
            return ""
        for line in r.iter_lines():
            if line.startswith("data: "):
                try:
                    events.append(json.loads(line[6:]))
                except ValueError:
                    pass
    for evt in reversed(events):
        if evt.get("type") == "final":
            return str((evt.get("data") or {}).get("text") or "")
    return ""


def switch(client: httpx.Client, sid: str, harness: str) -> dict:
    r = client.post(
        f"{BASE}/api/sessions/{sid}/harness/switch",
        headers=AUTH,
        json={"harness_id": harness},
        timeout=120.0,
    )
    return {"status": r.status_code, "body": r.json() if r.status_code == 200 else r.text}


def handoffs(client: httpx.Client, sid: str) -> list[dict]:
    r = client.get(f"{BASE}/api/sessions/{sid}/handoffs", headers=AUTH)
    return (r.json() or {}).get("handoffs") or []


def run_seed(seed_idx: int) -> dict:
    seed = SEEDS[seed_idx]
    keys = seed["keys"]
    task = seed["task"]
    sections = seed["sections"]
    home = tempfile.mkdtemp(prefix=f"sp6-seed{seed_idx}-")
    proc = start_server(home)
    result = {
        "seed": seed_idx,
        "keys": keys,
        "turns": 0,
        "switches": [],
        "survival": {"recalled": [], "missing": []},
        "completion": False,
        "final_answer": "",
        "summary_checks": [],
    }
    try:
        with httpx.Client(timeout=60.0, trust_env=False) as client:
            sid = client.get(f"{BASE}/api/session", headers=AUTH).json()["session_id"]
            client.post(
                f"{BASE}/api/sessions/{sid}/harness",
                headers=AUTH,
                json={"harness_id": "opencode"},
            )

            # Turn 1-2 (real LLM): plant three anchors + task state.
            r1 = chat_sse(
                client,
                sid,
                f"We are working on a {task}. The first access key is {keys[0]}. "
                f"We have finished section 1: {sections[0]}. "
                "Reply with exactly: NOTED",
            )
            result["turns"] += 1
            r2 = chat_sse(
                client,
                sid,
                f"Progress update: the second access key is {keys[1]}, and the "
                f"third access key is {keys[2]}. We have now also finished "
                f"section 2: {sections[1]}. Reply with exactly: UPDATED",
            )
            result["turns"] += 1
            planted = "NOTED" in r1 and "UPDATED" in r2
            result["planted"] = planted

            # Switch 1: A -> B (codex stub)
            sw = switch(client, sid, "codex")
            result["switches"].append(
                {"to": "codex", "status": sw["status"],
                 "strategy": (sw["body"].get("switch") or {}).get("strategy")}
            )
            chat_sse(client, sid, "Continue the work on the current task.")  # stub turn
            result["turns"] += 1

            # Switch 2: B -> A (resume)
            sw = switch(client, sid, "opencode")
            result["switches"].append(
                {"to": "opencode", "status": sw["status"],
                 "strategy": (sw["body"].get("switch") or {}).get("strategy"),
                 "native_thread_resumed": bool(
                     ((sw["body"].get("switch") or {}).get("native_thread_id") or ""
                      ).startswith("ses_")
                 )}
            )

            # Turn 3 (real LLM): survival probe.
            r3 = chat_sse(
                client,
                sid,
                "Without any new information: list every access key you were "
                "given, one per line, in the order I gave them.",
            )
            result["turns"] += 1
            for key in keys:
                if key in r3:
                    result["survival"]["recalled"].append(key)
                else:
                    result["survival"]["missing"].append(key)

            # Switch 3 + stub turn + Switch 4 (double round-trip).
            sw3 = switch(client, sid, "codex")
            result["switches"].append(
                {"to": "codex", "status": sw3["status"],
                 "strategy": (sw3["body"].get("switch") or {}).get("strategy")}
            )
            chat_sse(client, sid, "Keep going.")
            result["turns"] += 1
            sw4 = switch(client, sid, "opencode")
            result["switches"].append(
                {"to": "opencode", "status": sw4["status"],
                 "strategy": (sw4["body"].get("switch") or {}).get("strategy")}
            )

            # Turn 4 (real LLM): completion probe — ordered keys + task state.
            r4 = chat_sse(
                client,
                sid,
                f"Final check for the {task}: reply with (a) the three access "
                "keys in their original order on one line separated by "
                "spaces, then (b) which two sections of the report are "
                "finished, as a short sentence.",
            )
            result["turns"] += 1
            result["final_answer"] = r4[:600]
            keys_ok = all(key in r4 for key in keys)
            order_ok = (
                r4.find(keys[0]) < r4.find(keys[1]) < r4.find(keys[2])
                if keys_ok
                else False
            )
            sections_ok = all(s in r4 for s in sections[:2])
            result["completion"] = bool(keys_ok and order_ok and sections_ok)
            result["completion_detail"] = {
                "keys_ok": keys_ok,
                "order_ok": order_ok,
                "sections_ok": sections_ok,
            }

            # Summary spot-checks over every recorded handoff. The summary is
            # the fixed eight-section contract (no adapter free-styling); every
            # section must be present and filled (placeholders like
            # "(none recorded)" count as filled per the contract).
            eight = [
                "goal", "decisions", "changed_files", "commands_and_tests",
                "plan_and_todos", "open_approvals", "checkpoint_diff",
                "known_failures",
            ]
            for row in handoffs(client, sid):
                handoff = row.get("handoff") or {}
                summary = handoff.get("summary") or {}
                serialized = json.dumps(summary, ensure_ascii=False)
                checks = {
                    "handoff_id": handoff.get("handoff_id"),
                    "from": handoff.get("from_harness"),
                    "to": handoff.get("to_harness"),
                    "status": row.get("status"),
                    "strategy": handoff.get("strategy"),
                    "goal_nonempty": bool(str(summary.get("goal") or "").strip()),
                    "goal_carries_task": task.split()[0] in str(summary.get("goal") or ""),
                    "goal_carries_anchor": keys[0] in str(summary.get("goal") or ""),
                    "eight_sections_present": all(s in summary for s in eight),
                    "eight_sections_filled": all(
                        str(summary.get(s) or "").strip() for s in eight
                    ),
                    "decisions_carries_activity": str(
                        summary.get("decisions") or ""
                    ) != "(none recorded)",
                    "task_state_carried": any(s in serialized for s in sections[:2]),
                }
                result["summary_checks"].append(checks)
                result.setdefault("raw_summaries", []).append(
                    {
                        "handoff_id": handoff.get("handoff_id"),
                        "strategy": handoff.get("strategy"),
                        "from": handoff.get("from_harness"),
                        "to": handoff.get("to_harness"),
                        "summary": summary,
                    }
                )
    finally:
        stop_server(proc)
        subprocess.run(["rm", "-rf", home], check=False)

    with open(f"/tmp/sp6_seed{seed_idx}.json", "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"--- seed {seed_idx} ---")
    print(f"planted={result.get('planted')}")
    print(
        f"survival={len(result['survival']['recalled'])}/3 "
        f"missing={result['survival']['missing']}"
    )
    print(f"completion={result['completion']} detail={result.get('completion_detail')}")
    print(f"switches={json.dumps(result['switches'], ensure_ascii=False)}")
    print(f"summary_checks={json.dumps(result['summary_checks'], ensure_ascii=False)}")
    return result


if __name__ == "__main__":
    idx = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    run_seed(idx)
