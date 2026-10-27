#!/usr/bin/env python3
"""Database URL splitting for async and sync drivers.

Author: Damon Li
"""

from __future__ import annotations

import pytest

from ma_agent_runtime.db import split_database_url


def test_postgres_urls() -> None:
    urls = split_database_url("postgresql://u:p@h:5432/db?sslmode=require")
    assert urls.async_url == "postgresql+asyncpg://u:p@h:5432/db"
    assert urls.async_connect_args["ssl"] == "require"
    assert urls.sync_url == "postgresql+psycopg2://u:p@h:5432/db?sslmode=require"
    assert urls.dialect == "postgresql"

    postgres = split_database_url("postgres://u:p@h:5432/db?sslmode=require", search_path="s1")
    assert postgres.async_url == "postgresql+asyncpg://u:p@h:5432/db"
    assert postgres.async_connect_args["ssl"] == "require"
    assert postgres.async_connect_args["server_settings"]["search_path"] == "s1"
    assert postgres.sync_connect_args["options"] == "-csearch_path=s1"
    assert postgres.sync_url == "postgresql+psycopg2://u:p@h:5432/db?sslmode=require"

    sqlite = split_database_url("sqlite:///tmp/a.db")
    assert sqlite.async_url == "sqlite+aiosqlite:///tmp/a.db"
    assert sqlite.sync_url == "sqlite:///tmp/a.db"
    assert sqlite.dialect == "sqlite"

    with pytest.raises(ValueError, match="unsupported database url"):
        split_database_url("mysql://u:p@h:3306/db")
