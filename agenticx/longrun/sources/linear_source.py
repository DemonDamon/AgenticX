#!/usr/bin/env python3
"""Optional Linear GraphQL polling source for ``agenticx.longrun``.

Author: Damon Li
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

import httpx

_log = logging.getLogger(__name__)

LINEAR_API = "https://api.linear.app/graphql"


class LinearTaskSource:
    """Fetch small batches of open issues when ``linear_api_key`` is configured."""

    def __init__(self, *, api_key: str, team_ids: str = "", limit: int = 10) -> None:
        self._api_key = str(api_key or "").strip()
        self._team_ids = [t.strip() for t in str(team_ids or "").split(",") if t.strip()]
        self._limit = max(1, min(int(limit), 50))

    async def fetch_pending_tasks(self) -> List[Dict[str, Any]]:
        if not self._api_key:
            return []
        query = """
        query Issues($first: Int!) {
          issues(first: $first) {
            nodes {
              id
              identifier
              title
              description
            }
          }
        }
        """
        payload = {"query": query, "variables": {"first": self._limit}}
        headers = {"Authorization": self._api_key, "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(LINEAR_API, json=payload, headers=headers)
                resp.raise_for_status()
                body = resp.json()
        except Exception as exc:
            _log.warning("LinearTaskSource fetch failed: %s", exc)
            return []
        data = body.get("data") if isinstance(body, dict) else None
        issues = (
            (data or {}).get("issues") or {}
        ).get("nodes") if isinstance(data, dict) else None
        if not isinstance(issues, list):
            return []
        rows: List[Dict[str, Any]] = []
        for node in issues:
            if not isinstance(node, dict):
                continue
            lid = str(node.get("id", "") or "").strip()
            ident = str(node.get("identifier", "") or "").strip()
            title = str(node.get("title", "") or "").strip()
            desc = str(node.get("description", "") or "").strip()
            if not lid:
                continue
            task_body = title if title else desc
            if desc and title:
                task_body = f"{title}\n\n{desc}"
            rows.append(
                {
                    "id": f"linear-{lid}",
                    "task": task_body or "(empty issue)",
                    "name": ident or lid[:8],
                    "role": "linear",
                    "wants_continuation": False,
                    "linear_issue_id": lid,
                }
            )
        if self._team_ids:
            # Without team-scoped schema wiring, filter is best-effort noop — placeholder for future team filter.
            return rows
        return rows

    async def mark_task_done(self, task_id: str) -> None:
        _log.debug("LinearTaskSource.mark_task_done noop for %s", task_id)
