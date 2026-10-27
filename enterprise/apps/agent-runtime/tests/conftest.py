#!/usr/bin/env python3
"""Put the agent-runtime package on sys.path and open test databases.

Author: Damon Li
"""

from __future__ import annotations

import os
import secrets
import sys
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ma_agent_runtime.db import build_engines, split_database_url  # noqa: E402
from ma_agent_runtime.pg_event_store import PgEventStore  # noqa: E402
from ma_agent_runtime.pg_work_queue import PgWorkQueue  # noqa: E402
from ma_agent_runtime.tables import metadata  # noqa: E402


class Clock:
    """Controllable UTC clock for lease tests."""

    def __init__(self) -> None:
        self.now = datetime(2026, 10, 25, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now = self.now + timedelta(seconds=seconds)


def _pg_url() -> str:
    url = os.environ.get("MA_TEST_DATABASE_URL", "").strip()
    if not url:
        pytest.skip("MA_TEST_DATABASE_URL not set")
    return url


def _open_urls(kind: str, tmp_path: Path) -> tuple[object, object]:
    """Return ``(DatabaseUrls, cleanup)``."""
    if kind == "sqlite":
        urls = split_database_url(f"sqlite:///{tmp_path / 'ma.db'}")
        return urls, lambda: None
    raw = _pg_url()
    schema = "ma_test_" + secrets.token_hex(4)
    admin = split_database_url(raw)
    admin_engine = create_engine(admin.sync_url, connect_args=admin.sync_connect_args)
    with admin_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    admin_engine.dispose()
    urls = split_database_url(raw, search_path=schema)

    def cleanup() -> None:
        engine = create_engine(admin.sync_url, connect_args=admin.sync_connect_args)
        with engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()

    return urls, cleanup


@pytest.fixture
def sqlite_urls(tmp_path: Path):
    """SQLite URLs plus a created schema."""
    urls = split_database_url(f"sqlite:///{tmp_path / 'ma.db'}")
    sync_engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
    metadata.create_all(sync_engine)
    sync_engine.dispose()
    return urls


@pytest.fixture(params=["sqlite", "pg"])
async def store(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[PgEventStore]:
    urls, cleanup = _open_urls(request.param, tmp_path)
    async_engine, sync_engine = build_engines(urls, pool_size=4)
    metadata.create_all(sync_engine)
    event_store = PgEventStore(async_engine)
    event_store.reopen_urls = urls  # type: ignore[attr-defined]
    try:
        yield event_store
    finally:
        await event_store.close()
        sync_engine.dispose()
        cleanup()


@pytest.fixture(params=["sqlite", "pg"])
def work_queue(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[PgWorkQueue]:
    urls, cleanup = _open_urls(request.param, tmp_path)
    sync_engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
    metadata.create_all(sync_engine)
    clock = Clock()
    queue = PgWorkQueue(sync_engine, clock=clock)
    queue.clock = clock  # type: ignore[attr-defined]
    try:
        yield queue
    finally:
        sync_engine.dispose()
        cleanup()
