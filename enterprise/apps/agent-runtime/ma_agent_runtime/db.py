#!/usr/bin/env python3
"""Async and sync SQLAlchemy engines for the managed agent runtime.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import parse_qsl, urlencode

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

_SSL_MODES = frozenset({"disable", "allow", "prefer", "require", "verify-ca", "verify-full"})


@dataclass(frozen=True)
class DatabaseUrls:
    """Dialect-specific URLs plus driver connect arguments."""

    async_url: str
    sync_url: str
    async_connect_args: dict[str, Any]
    sync_connect_args: dict[str, Any]
    dialect: Literal["postgresql", "sqlite"]


def split_database_url(url: str, *, search_path: str | None = None) -> DatabaseUrls:
    """Map a service URL onto async and sync SQLAlchemy URLs."""
    if url.startswith("postgresql://") or url.startswith("postgres://"):
        return _split_postgres(url, search_path)
    if url.startswith("sqlite:///"):
        suffix = url[len("sqlite://") :]
        return DatabaseUrls(
            async_url="sqlite+aiosqlite://" + suffix,
            sync_url=url,
            async_connect_args={"timeout": 30},
            sync_connect_args={"timeout": 30, "check_same_thread": False},
            dialect="sqlite",
        )
    raise ValueError("unsupported database url")


def build_engines(urls: DatabaseUrls, *, pool_size: int) -> tuple[AsyncEngine, Engine]:
    """Open the async event-store engine and the sync work-queue engine."""
    if urls.dialect == "sqlite":
        async_engine = create_async_engine(urls.async_url, connect_args=urls.async_connect_args)
        sync_engine = create_engine(urls.sync_url, connect_args=urls.sync_connect_args)
        return async_engine, sync_engine
    async_engine = create_async_engine(
        urls.async_url,
        pool_size=pool_size,
        max_overflow=pool_size,
        pool_pre_ping=True,
        connect_args=urls.async_connect_args,
    )
    sync_engine = create_engine(
        urls.sync_url,
        pool_size=max(2, pool_size // 2),
        max_overflow=2,
        pool_pre_ping=True,
        connect_args=urls.sync_connect_args,
    )
    return async_engine, sync_engine


def _split_postgres(url: str, search_path: str | None) -> DatabaseUrls:
    _scheme, rest = url.split("://", 1)
    if "?" in rest:
        base, query = rest.split("?", 1)
    else:
        base, query = rest, ""
    pairs = parse_qsl(query, keep_blank_values=True)
    sslmode: str | None = None
    kept: list[tuple[str, str]] = []
    for key, value in pairs:
        if key == "sslmode":
            sslmode = value
        else:
            kept.append((key, value))
    async_query = urlencode(kept)
    sync_query = urlencode(pairs)
    async_url = "postgresql+asyncpg://" + base
    sync_url = "postgresql+psycopg2://" + base
    if async_query:
        async_url += "?" + async_query
    if sync_query:
        sync_url += "?" + sync_query
    async_args: dict[str, Any] = {}
    sync_args: dict[str, Any] = {}
    if sslmode in _SSL_MODES:
        async_args["ssl"] = sslmode
    if search_path:
        async_args["server_settings"] = {"search_path": search_path}
        sync_args["options"] = f"-csearch_path={search_path}"
    return DatabaseUrls(
        async_url=async_url,
        sync_url=sync_url,
        async_connect_args=async_args,
        sync_connect_args=sync_args,
        dialect="postgresql",
    )


__all__ = [
    "DatabaseUrls",
    "build_engines",
    "split_database_url",
]
