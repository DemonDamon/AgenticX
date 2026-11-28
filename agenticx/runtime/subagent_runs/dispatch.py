"""Persistent dispatch records, mailbox claims, and context snapshots.

A *dispatch* is one delegated unit of work. It is 1:1 with a spawned sub-agent
run and persists the identity needed to address that unit after a process
restart: ``dispatch_id``, ``task_id`` (the worker run id), the parent task and
the work unit. The record lives under ``detail_refs["dispatch"]`` of the run
record, so it follows the run record's lifecycle and local-disk scope.

A *mail* is one instruction addressed to a dispatch. Every accepted mail is
written to the worker's mailbox as consumed *before* any execution starts, so
re-delivering the same ``message_id`` never executes twice. The guarantee is
at-most-once, not exactly-once: a crash between the persisted claim and the
end of the turn loses that mail.

Author: Damon Li
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from agenticx.runtime.subagent_runs.contracts import RunRecord
from agenticx.runtime.subagent_runs.store import SubAgentRunStore

DISPATCH_DETAIL_KEY = "dispatch"
DISPATCH_ID_PREFIX = "dsp-"
DISPATCH_STATE_RUNNING = "running"
DISPATCH_STATE_WAITING = "waiting"
DISPATCH_STATE_CLOSED = "closed"
LEDGER_NAMESPACE = "dispatch"
MAILBOX_SUFFIX = "mailbox"
CONTEXT_SUFFIX = "context"
AUX_SCHEMA_VERSION = 1
MAILBOX_KEEP = 50


class DispatchMailboxError(RuntimeError):
    """Identify a mailbox or snapshot file that could not be written."""


def new_dispatch_id() -> str:
    """Mint the addressable id of one delegation unit."""
    return f"{DISPATCH_ID_PREFIX}{uuid.uuid4().hex[:12]}"


def dispatch_ledger_session_id(owner_session_id: str, agent_id: str) -> str:
    """Return the ledger session namespace that isolates one worker's wake-up turns."""
    owner = str(owner_session_id or "").strip()
    return f"{owner}:{LEDGER_NAMESPACE}:{str(agent_id or '').strip()}"


def ledger_root_for(store: SubAgentRunStore) -> Optional[Path]:
    """Return the sessions root that hosts a per-session run store."""
    if not store.owner_session_id:
        return None
    return store.root.parent.parent


def dispatch_of(record: Optional[RunRecord]) -> Dict[str, Any]:
    """Return the persisted dispatch record of one run, or an empty dict."""
    payload = (record.detail_refs or {}).get(DISPATCH_DETAIL_KEY) if record is not None else None
    return dict(payload) if isinstance(payload, dict) else {}


def build_dispatch_detail(context: Any) -> Dict[str, Any]:
    """Build the dispatch record of a freshly spawned worker."""
    return {
        "dispatch_id": context.dispatch_id,
        "task_id": context.agent_id,
        "parent_agent_id": context.parent_agent_id,
        "parent_tool_call_id": context.source_tool_call_id,
        "work_unit": context.task,
        "depth": int(context.depth or 1),
        "mode": context.mode,
        "cleanup": context.cleanup,
        "run_timeout_seconds": int(context.run_timeout_seconds),
        "inherit_parent_context": bool(context.inherit_parent_context),
        "spawn_tree_path": context.spawn_tree_path,
        "workspace_dir": context.workspace_dir,
        "state": DISPATCH_STATE_RUNNING,
    }


def find_dispatch(store: SubAgentRunStore, query: str) -> Tuple[Optional[RunRecord], str]:
    """Find the spawned worker a mail address refers to.

    Returns ``(record, match_kind)`` where ``match_kind`` is ``"agent_id"``,
    ``"dispatch_id"``, ``"name"`` or ``"avatar_id"``. Exact identifiers win over
    aliases; among aliases the most recently updated run wins.
    """
    needle = str(query or "").strip()
    if not needle:
        return None, ""
    lowered = needle.lower()
    try:
        records = [record for record in store.list_runs() if record.kind == "spawn"]
    except Exception:
        return None, ""
    for record in records:
        if record.run_id == needle:
            return record, "agent_id"
    for record in records:
        dispatch_id = str(dispatch_of(record).get("dispatch_id") or "")
        if dispatch_id and dispatch_id == needle:
            return record, "dispatch_id"
    best: Optional[RunRecord] = None
    kind = ""
    for record in records:
        if not dispatch_of(record).get("dispatch_id"):
            continue
        if str(record.name or "").strip().lower() == lowered:
            matched = "name"
        elif str(record.avatar_id or "").strip().lower() == lowered:
            matched = "avatar_id"
        else:
            continue
        if best is None or float(record.updated_at or 0) > float(best.updated_at or 0):
            best, kind = record, matched
    if best is None:
        return None, ""
    return best, kind


def set_dispatch_state(store: SubAgentRunStore, run_id: str, state: str) -> bool:
    """Move one dispatch between ``running``, ``waiting`` and ``closed``."""
    try:
        with store.locked():
            record = store.get_run(run_id)
            dispatch = dispatch_of(record)
            if not dispatch.get("dispatch_id"):
                return False
            dispatch["state"] = state
            dispatch["state_changed_at"] = time.time()
            return store.merge_detail_refs(run_id, {DISPATCH_DETAIL_KEY: dispatch}) is not None
    except Exception:
        return False


def claim_mail(
    store: SubAgentRunStore,
    run_id: str,
    *,
    dispatch_id: str,
    message_id: str,
    text: str,
    consumed_by: str,
) -> Tuple[bool, Dict[str, Any]]:
    """Persist one mail as consumed unless its ``message_id`` was already claimed.

    Returns ``(True, mail)`` for a fresh mail and ``(False, existing)`` for a
    duplicate. Raises ``DispatchMailboxError`` when the claim cannot be
    persisted; callers must then refuse to execute.
    """
    mid = str(message_id or "").strip()
    if not mid:
        raise ValueError("message_id must not be empty")
    try:
        with store.locked():
            payload = store.read_aux_json(run_id, MAILBOX_SUFFIX) or {}
            mails = [item for item in (payload.get("mails") or []) if isinstance(item, dict)]
            for mail in mails:
                if str(mail.get("message_id") or "") == mid:
                    return False, dict(mail)
            mail = {
                "message_id": mid,
                "dispatch_id": dispatch_id,
                "text": text,
                "state": "consumed",
                "consumed_by": consumed_by,
                "consumed_at": time.time(),
            }
            mails.append(mail)
            store.write_aux_json(
                run_id,
                MAILBOX_SUFFIX,
                {
                    "schema_version": AUX_SCHEMA_VERSION,
                    "dispatch_id": dispatch_id,
                    "agent_id": run_id,
                    "mails": mails[-MAILBOX_KEEP:],
                },
            )
            return True, dict(mail)
    except DispatchMailboxError:
        raise
    except Exception as exc:
        raise DispatchMailboxError(f"mail claim failed for {run_id}") from exc


def read_mailbox(store: SubAgentRunStore, run_id: str) -> List[Dict[str, Any]]:
    """Return the persisted mails of one dispatch, oldest first."""
    payload = store.read_aux_json(run_id, MAILBOX_SUFFIX) or {}
    return [dict(item) for item in (payload.get("mails") or []) if isinstance(item, dict)]


def write_context_snapshot(store: SubAgentRunStore, run_id: str, payload: Dict[str, Any]) -> None:
    """Persist the rebuildable context of one waiting worker."""
    body: Dict[str, Any] = {"schema_version": AUX_SCHEMA_VERSION, "agent_id": run_id}
    body.update(payload or {})
    try:
        store.write_aux_json(run_id, CONTEXT_SUFFIX, body)
    except Exception as exc:
        raise DispatchMailboxError(f"context snapshot failed for {run_id}") from exc


def read_context_snapshot(store: SubAgentRunStore, run_id: str) -> Optional[Dict[str, Any]]:
    """Return the persisted context snapshot of one worker, or None."""
    return store.read_aux_json(run_id, CONTEXT_SUFFIX)


def delete_dispatch_ledger_runs(owner_session_id: str, *, sessions_root: Path) -> int:
    """Delete the namespaced wake-up ledger runs of every dispatch in one session."""
    try:
        from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

        records = SubAgentRunStore(owner_session_id).list_runs()
    except Exception:
        return 0
    ledger = ReplayLedgerStore(sessions_root)
    deleted = 0
    for record in records:
        if not dispatch_of(record).get("dispatch_id"):
            continue
        try:
            ledger.delete_session_runs(
                dispatch_ledger_session_id(owner_session_id, record.run_id)
            )
            deleted += 1
        except Exception:
            continue
    return deleted
