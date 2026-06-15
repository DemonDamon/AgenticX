#!/usr/bin/env python3
"""Rebuild the Kuzu memory-graph DB while dropping specific Episodic nodes.

Kuzu 0.11.3 segfaults on ``DELETE`` of certain ``Episodic`` nodes (the engine crashes
even for plain ``DELETE n`` after edges are removed), which makes in-place episode
deletion impossible. Reads and ``COPY`` are unaffected, so this module deletes episodes
by rebuilding the DB: export every table to parquet (excluding the target Episodic nodes
and their dangling edges), recreate an empty schema via Graphiti, ``COPY FROM`` the
parquet files, then atomically swap the rebuilt DB in (with a timestamped backup).

The caller MUST ensure no other process/handle holds a write lock on the DB
(``MemoryGraphStore.reset_runtime`` + single ``agx serve``) before invoking this.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _rows(conn: Any, query: str, params: Optional[dict] = None) -> List[list]:
    result = conn.execute(query, params or {})
    out: List[list] = []
    while result.has_next():
        out.append(result.get_next())
    return out


def _backup_paths(db_path: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{db_path}.bak-{ts}"


def _copy_db_files(src: str, dst: str) -> None:
    shutil.copy(src, dst)
    wal = src + ".wal"
    if os.path.exists(wal):
        shutil.copy(wal, dst + ".wal")


def _remove_db_files(path: str) -> None:
    for p in (path, path + ".wal"):
        if os.path.isdir(p):
            shutil.rmtree(p, ignore_errors=True)
        elif os.path.exists(p):
            os.remove(p)


async def _build_empty_schema(new_path: str, cfg: Any) -> None:
    """Create an empty Kuzu DB with the full Graphiti schema (indices included)."""
    from graphiti_core import Graphiti
    from graphiti_core.driver.kuzu_driver import KuzuDriver

    from agenticx.memory.graph.clients import build_graphiti_clients
    from agenticx.memory.graph.store import _dispose_kuzu_driver, _prepare_kuzu_driver

    driver = KuzuDriver(db=new_path)
    _prepare_kuzu_driver(driver)
    try:
        llm_client, embedder, cross_encoder = build_graphiti_clients(cfg)
        graphiti = Graphiti(
            graph_driver=driver,
            llm_client=llm_client,
            embedder=embedder,
            cross_encoder=cross_encoder,
        )
        await graphiti.build_indices_and_constraints()
    finally:
        _dispose_kuzu_driver(driver)


def _rebuild_sync(delete_uuids: List[str], cfg: Any) -> Dict[str, Any]:
    """Synchronous rebuild (run in a worker thread, owns its own event loop)."""
    import kuzu

    exclude = {str(x).strip() for x in delete_uuids if str(x).strip()}
    db_path = str(cfg.db_path.expanduser())
    if not os.path.exists(db_path):
        raise RuntimeError(f"graph db not found: {db_path}")
    if not exclude:
        return {"deleted": [], "remaining": -1, "backup": None}

    backup = _backup_paths(db_path)
    _copy_db_files(db_path, backup)
    logger.info("memory graph rebuild: backup -> %s", backup)

    tmpdir = tempfile.mkdtemp(prefix="agx_gkb_")
    new_path = db_path + ".rebuild"
    _remove_db_files(new_path)

    try:
        old_db = kuzu.Database(db_path, read_only=True)
        oc = kuzu.Connection(old_db)

        existing = {r[0] for r in _rows(oc, "MATCH (n:Episodic) RETURN n.uuid")}
        deleted = sorted(exclude & existing)

        tables = _rows(oc, "CALL show_tables() RETURN *")
        node_tables = [t[1] for t in tables if t[2] == "NODE"]
        rel_tables = [t[1] for t in tables if t[2] == "REL"]

        node_exports: List[tuple] = []  # (table, parquet)
        for t in node_tables:
            cols = [c[1] for c in _rows(oc, f"CALL table_info('{t}') RETURN *")]
            ret = ", ".join(f"n.{c}" for c in cols)
            where = "WHERE NOT n.uuid IN $ex" if t == "Episodic" else ""
            pq = os.path.join(tmpdir, f"node_{t}.parquet")
            oc.execute(
                f"COPY (MATCH (n:{t}) {where} RETURN {ret}) TO '{pq}'",
                {"ex": list(exclude)} if where else {},
            )
            node_exports.append((t, pq))

        rel_exports: List[tuple] = []  # (table, src_tbl, dst_tbl, parquet)
        for t in rel_tables:
            pairs = _rows(oc, f"CALL show_connection('{t}') RETURN *")
            cols = [c[1] for c in _rows(oc, f"CALL table_info('{t}') RETURN *")]
            for i, info in enumerate(pairs):
                src_tbl, dst_tbl, src_pk, dst_pk = info[0], info[1], info[2], info[3]
                parts = [f"a.{src_pk}", f"b.{dst_pk}"] + [f"r.{c}" for c in cols]
                conds = []
                if src_tbl == "Episodic":
                    conds.append(f"NOT a.{src_pk} IN $ex")
                if dst_tbl == "Episodic":
                    conds.append(f"NOT b.{dst_pk} IN $ex")
                where = ("WHERE " + " AND ".join(conds)) if conds else ""
                pq = os.path.join(tmpdir, f"rel_{t}_{i}.parquet")
                oc.execute(
                    f"COPY (MATCH (a:{src_tbl})-[r:{t}]->(b:{dst_tbl}) {where} "
                    f"RETURN {', '.join(parts)}) TO '{pq}'",
                    {"ex": list(exclude)} if where else {},
                )
                rel_exports.append((t, src_tbl, dst_tbl, pq))

        del oc
        old_db.close() if hasattr(old_db, "close") else None
        del old_db

        asyncio.run(_build_empty_schema(new_path, cfg))

        new_db = kuzu.Database(new_path)
        nc = kuzu.Connection(new_db)
        for t, pq in node_exports:
            nc.execute(f"COPY {t} FROM '{pq}'")
        for t, src_tbl, dst_tbl, pq in rel_exports:
            nc.execute(f"COPY {t} FROM '{pq}' (from='{src_tbl}', to='{dst_tbl}')")
        remaining = _rows(nc, "MATCH (n:Episodic) RETURN count(n)")[0][0]
        del nc
        new_db.close() if hasattr(new_db, "close") else None
        del new_db

        # Atomic-ish swap: drop old, promote rebuilt.
        _remove_db_files(db_path)
        os.rename(new_path, db_path)
        if os.path.exists(new_path + ".wal"):
            os.rename(new_path + ".wal", db_path + ".wal")

        logger.info(
            "memory graph rebuild done: deleted=%d remaining=%d", len(deleted), remaining
        )
        return {"deleted": deleted, "remaining": int(remaining), "backup": backup}
    except Exception:
        # Restore from backup on any failure so the live DB is never left broken.
        try:
            _remove_db_files(new_path)
            if os.path.exists(backup):
                _remove_db_files(db_path)
                _copy_db_files(backup, db_path)
        except Exception:
            logger.exception("memory graph rebuild: restore from backup failed")
        raise
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def rebuild_graph_excluding_episodes(
    delete_uuids: List[str], *, cfg: Any = None
) -> Dict[str, Any]:
    """Delete episodes by rebuilding the DB (workaround for Kuzu DELETE SIGSEGV).

    Returns ``{"deleted": [...], "remaining": int, "backup": path}``.
    """
    if cfg is None:
        from agenticx.memory.graph.config import load_memory_graph_config

        cfg = load_memory_graph_config()
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _rebuild_sync, list(delete_uuids), cfg)
