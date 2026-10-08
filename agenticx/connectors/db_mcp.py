"""Built-in database MCP server (stdio): ``python -m agenticx.connectors.db_mcp``.

Tools: ``list_tables``, ``describe_table``, ``query`` (read-only SELECT with a
row limit) and — only when ``AGX_DB_ALLOW_WRITES=1`` — ``execute_write``.
Configuration via ``AGX_DB_*`` env (see :mod:`agenticx.connectors.database`).

Author: Damon Li
"""

from __future__ import annotations

import json
from typing import Optional

from agenticx.connectors.database import Database, DbConfig, DbError


def build_server(cfg: Optional[DbConfig] = None):
    from mcp.server.fastmcp import FastMCP

    cfg = cfg or DbConfig.from_env()
    label = cfg.db_type or "database"
    mcp = FastMCP(f"agenticx-db-{label}")
    db_holder: dict = {}

    def _db() -> Database:
        if "db" not in db_holder:
            db_holder["db"] = Database(cfg)
        return db_holder["db"]

    def _out(payload) -> str:
        return json.dumps(payload, ensure_ascii=False, default=str)

    @mcp.tool(description=f"List tables/views in the connected {label} database.")
    def list_tables() -> str:
        try:
            return _out({"tables": _db().list_tables()})
        except DbError as exc:
            return _out({"error": str(exc)})

    @mcp.tool(description="Describe a table's columns (name, type, nullable, default, primary key).")
    def describe_table(table: str) -> str:
        try:
            return _out(_db().describe_table(table))
        except DbError as exc:
            return _out({"error": str(exc)})

    @mcp.tool(
        description=(
            "Run ONE read-only SQL statement (SELECT / WITH / SHOW / DESCRIBE / EXPLAIN). "
            f"Results are capped at `limit` rows (default {cfg.row_limit}); `truncated` tells you if more exist. "
            "Add your own WHERE/LIMIT for large tables."
        )
    )
    def query(sql: str, limit: Optional[int] = None) -> str:
        try:
            return _out(_db().query(sql, limit))
        except DbError as exc:
            return _out({"error": str(exc)})

    if cfg.allow_writes:

        @mcp.tool(description="Execute ONE data-changing SQL statement (writes were explicitly enabled for this connector). Confirm with the user first.")
        def execute_write(sql: str) -> str:
            try:
                return _out(_db().execute_write(sql))
            except DbError as exc:
                return _out({"error": str(exc)})

    return mcp


def main() -> None:
    build_server().run("stdio")


if __name__ == "__main__":
    main()
