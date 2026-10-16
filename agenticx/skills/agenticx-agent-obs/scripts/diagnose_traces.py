#!/usr/bin/env python3
"""Diagnostic CLI for AgenticX Observability (local session runs + enterprise config check)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List


def _load_enterprise_config() -> Dict[str, Any]:
    cfg_path = Path.home() / ".agenticx" / "config.yaml"
    if not cfg_path.is_file():
        return {"exists": False, "path": str(cfg_path)}
    try:
        import yaml  # type: ignore[import-untyped]

        data = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        ent = data.get("enterprise") if isinstance(data, dict) else {}
        if not isinstance(ent, dict):
            ent = {}
        has_credential = bool(ent.get("token"))
        return {
            "exists": True,
            "path": str(cfg_path),
            "enabled": bool(ent.get("enabled")),
            "base_url": str(ent.get("base_url") or ""),
            "credential_configured": has_credential,
            "user_email": str(ent.get("user_email") or ""),
        }
    except Exception as exc:
        return {"exists": True, "path": str(cfg_path), "error": str(exc)}


def _scan_local_runs(limit: int = 20) -> List[Dict[str, Any]]:
    sessions_root = Path.home() / ".agenticx" / "sessions"
    if not sessions_root.is_dir():
        return []
    runs: List[Dict[str, Any]] = []
    for events_file in sorted(
        sessions_root.glob("*/runs/*/events.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )[:limit]:
        session_id = events_file.parent.parent.parent.name
        run_id = events_file.parent.name
        model = ""
        errors: List[str] = []
        tool_calls = 0
        user_text = ""
        for line in events_file.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            ev_type = str(ev.get("type") or "")
            payload = ev.get("payload") if isinstance(ev.get("payload"), dict) else {}
            if ev_type == "user_message" and not user_text:
                user_text = str(payload.get("text") or "")[:120]
            elif ev_type == "tool_call":
                tool_calls += 1
            elif ev_type == "error":
                errors.append(str(payload.get("message") or payload.get("error") or "error")[:160])
            if not model and payload.get("model"):
                model = str(payload.get("model"))
        runs.append(
            {
                "trace_id": f"near:{session_id}:{run_id}",
                "session_id": session_id,
                "run_id": run_id,
                "status": "error" if errors else "ok",
                "model": model or "unknown",
                "tool_calls": tool_calls,
                "user_text": user_text,
                "errors": errors,
            }
        )
    return runs


def main() -> None:
    parser = argparse.ArgumentParser(description="Diagnose AgenticX observability status and recent traces.")
    parser.add_argument("--mode", choices=["summary", "errors"], default="summary")
    parser.add_argument("--trace-id", default="", help="Filter by specific trace_id or run_id substring")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    config_info = _load_enterprise_config()
    runs = _scan_local_runs(limit=max(1, args.limit))
    if args.trace_id:
        needle = args.trace_id.strip()
        runs = [r for r in runs if needle in r["trace_id"] or needle in r["run_id"]]
    if args.mode == "errors":
        runs = [r for r in runs if r["status"] != "ok"]

    output = {
        "enterprise_config": config_info,
        "total_scanned": len(runs),
        "error_runs": sum(1 for r in runs if r["status"] != "ok"),
        "runs": runs,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
