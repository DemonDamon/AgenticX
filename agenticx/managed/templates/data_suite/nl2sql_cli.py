"""Admin JSON stdin/stdout bridge for NL2SQL explain|execute (W2/W4).

Usage:
  echo '{"question":"…","mode":"explain"}' | python -m agenticx.managed.templates.data_suite.nl2sql_cli
  echo '{"question":"…","mode":"execute","sql":"SELECT 1"}' | python -m …
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional

from agenticx.managed.llm import LLMCallContext
from agenticx.managed.templates.data_suite.nl2sql import FakeQueryChannel, run_nl2sql
from agenticx.managed.testing import ScriptedLLM, ScriptStep, StaticLLMFactory


def _draft_sql(question: str, forced: Optional[str]) -> str:
    if forced and str(forced).strip():
        return str(forced).strip()
    q = (question or "").strip()
    if "退货" in q or "GMV" in q.upper() or "华东" in q:
        return (
            "SELECT region, gmv, return_rate "
            "FROM retail_monthly "
            "WHERE region = '华东' AND month = date_trunc('month', current_date) - interval '1 month'"
        )
    if "INSERT" in q.upper() or "删除" in q or "写入" in q:
        return "INSERT INTO retail_monthly(region, gmv) VALUES ('华东', 0)"
    return "SELECT 1 AS ok"


def _rows_for(sql: str) -> List[dict]:
    upper = sql.upper()
    if "RETAIL_MONTHLY" in upper or "GMV" in upper:
        return [{"region": "华东", "gmv": 12800000, "return_rate": 0.032}]
    return [{"ok": 1}]


def handle(req: Dict[str, Any]) -> Dict[str, Any]:
    question = str(req.get("question") or "")
    mode = req.get("mode")
    forced_sql = req.get("sql")
    draft = _draft_sql(question, str(forced_sql) if forced_sql is not None else None)
    llm = ScriptedLLM([ScriptStep(content=f"```sql\n{draft}\n```")])
    factory = StaticLLMFactory(llm)
    channel = FakeQueryChannel(_rows_for(draft))
    result = run_nl2sql(
        question or "问数",
        llm_factory=factory,
        channel=channel,
        context=LLMCallContext(
            tenant_id="admin",
            session_id="admin-nl2sql",
            agent_id="data-suite-nl2sql",
            agent_version=1,
            user_id="admin",
        ),
        provider="fake",
        model="scripted-nl2sql",
        mode=None if mode is None else str(mode),
    )
    return {
        "ok": True,
        "data": {
            "sql": result.sql,
            "rows": list(result.rows),
            "refused": bool(result.refused),
            "reason": result.reason,
            "mode": result.mode,
            "executed": bool(result.executed),
            "code": result.code,
            "channel_calls": list(channel.calls),
            "backend": "python",
        },
    }


def main() -> None:
    try:
        raw = sys.stdin.read() or "{}"
        req = json.loads(raw)
        if not isinstance(req, dict):
            raise ValueError("request must be a JSON object")
        out = handle(req)
    except Exception as exc:  # noqa: BLE001 — CLI boundary
        out = {"ok": False, "error": str(exc)}
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    sys.stdout.flush()
    if not out.get("ok"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
