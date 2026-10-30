"""H8: audience DSL pushdown to JDBC(sqlite) + ClickHouse SQL compile."""

from __future__ import annotations

import time
from pathlib import Path

import pytest
import yaml
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from agenticx.data_suite.audience.dsl import select_audience
from agenticx.data_suite.audience.pushdown import (
    compile_audience_sql,
    pushdown_select,
)
from agenticx.data_suite.channels.jdbc import JdbcChannel
from agenticx.data_suite.masking.engine import MaskingEngine
from agenticx.data_suite.masking.policy import FieldRule, MaskingPolicy

FIXTURE = Path(__file__).parent / "fixtures" / "sample_audience.yaml"

SAMPLE_ROWS = [
    {"member_id": "1", "tag_status_active": True, "tag_premium": True, "channel": "web"},
    {"member_id": "2", "tag_status_active": True, "tag_premium": False, "channel": "app"},
    {"member_id": "3", "tag_status_active": False, "tag_premium": True, "channel": "app"},
    {"member_id": "4", "tag_status_active": True, "tag_premium": False, "channel": "web"},
]


def _fixture_query():
    spec = yaml.safe_load(FIXTURE.read_text(encoding="utf-8"))
    return spec["query"], spec["id_field"]


def _memory_engine():
    return create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


def _seed_audience(engine, rows=None):
    rows = rows if rows is not None else SAMPLE_ROWS
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE audience ("
                "member_id TEXT, tag_status_active INTEGER, "
                "tag_premium INTEGER, channel TEXT, phone TEXT, email TEXT)"
            )
        )
        for r in rows:
            conn.execute(
                text(
                    "INSERT INTO audience "
                    "(member_id, tag_status_active, tag_premium, channel, phone, email) "
                    "VALUES (:member_id, :tag_status_active, :tag_premium, :channel, :phone, :email)"
                ),
                {
                    "member_id": str(r["member_id"]),
                    "tag_status_active": 1 if r.get("tag_status_active") else 0,
                    "tag_premium": 1 if r.get("tag_premium") else 0,
                    "channel": r.get("channel"),
                    "phone": r.get("phone"),
                    "email": r.get("email"),
                },
            )


def test_compile_sqlite_and_clickhouse_fixture():
    query, id_field = _fixture_query()
    sql_sqlite = compile_audience_sql(
        query, table="audience", id_field=id_field, dialect="sqlite"
    )
    sql_ch = compile_audience_sql(
        query, table="audience", id_field=id_field, dialect="clickhouse"
    )
    assert sql_sqlite.startswith("SELECT member_id FROM audience WHERE")
    assert "tag_status_active = 1" in sql_sqlite
    assert "tag_premium = 1" in sql_sqlite
    assert "channel IN ('app')" in sql_sqlite
    assert " AND " in sql_sqlite and " OR " in sql_sqlite

    assert sql_ch.startswith("SELECT member_id FROM audience WHERE")
    assert "tag_status_active = true" in sql_ch
    assert "tag_premium = true" in sql_ch
    assert "channel IN ('app')" in sql_ch


def test_compile_not_exists_in_and_rejects_bad_ident():
    sql = compile_audience_sql(
        {"op": "not", "args": [{"tag": "tag_premium", "op": "eq", "value": True}]},
        table="audience",
        dialect="sqlite",
    )
    assert "NOT" in sql and "tag_premium = 1" in sql

    sql_ex = compile_audience_sql(
        {"tag": "channel", "op": "exists"},
        table="audience",
        dialect="jdbc",
    )
    assert "channel IS NOT NULL" in sql_ex

    with pytest.raises(ValueError, match="invalid SQL identifier"):
        compile_audience_sql(
            {"tag": "tag;drop", "op": "eq", "value": 1},
            table="audience",
            dialect="sqlite",
        )


def test_jdbc_pushdown_matches_in_memory():
    query, id_field = _fixture_query()
    expected = select_audience(SAMPLE_ROWS, query, id_field=id_field)
    assert expected == ["1", "2"]

    engine = _memory_engine()
    _seed_audience(engine)
    ch = JdbcChannel(name="jdbc_aud", engine=engine, dialect="sqlite")
    got = pushdown_select(
        ch,
        query,
        table="audience",
        id_field=id_field,
        dialect="sqlite",
        columns=["member_id", "channel", "tag_premium"],
    )
    assert got.ids == expected
    assert got.dialect == "sqlite"
    assert "WHERE" in got.sql
    assert len(got.rows) == 2


def test_pushdown_masking_forced_when_policy_bound():
    query = {"tag": "tag_status_active", "op": "eq", "value": True}
    rows = [
        {
            "member_id": "1",
            "tag_status_active": True,
            "tag_premium": False,
            "channel": "web",
            "phone": "13800138000",
            "email": "a@example.com",
        },
        {
            "member_id": "2",
            "tag_status_active": False,
            "tag_premium": False,
            "channel": "app",
            "phone": "13900139000",
            "email": "b@example.com",
        },
    ]
    engine = _memory_engine()
    _seed_audience(engine, rows)
    ch = JdbcChannel(name="jdbc_aud", engine=engine, dialect="sqlite")
    policy = MaskingPolicy(
        id="aud_mask",
        rules=[
            FieldRule(
                field="phone",
                sensitivity="confidential",
                strategies={"analyst": "partial", "guest": "drop"},
                default_strategy="drop",
            ),
            FieldRule(
                field="email",
                sensitivity="internal",
                strategies={"analyst": "partial"},
                default_strategy="partial",
            ),
        ],
    )
    with pytest.raises(ValueError, match="role is required"):
        pushdown_select(
            ch,
            query,
            table="audience",
            columns=["member_id", "phone", "email"],
            masking=policy,
        )

    masked = pushdown_select(
        ch,
        query,
        table="audience",
        columns=["member_id", "phone", "email"],
        masking=policy,
        role="analyst",
    )
    assert masked.ids == ["1"]
    assert masked.rows[0]["phone"] == "1*********0"
    assert masked.rows[0]["email"] == "a***********m"

    unmasked = pushdown_select(
        ch,
        query,
        table="audience",
        columns=["member_id", "phone", "email"],
    )
    assert unmasked.rows[0]["phone"] == "13800138000"


@pytest.mark.slow
def test_pushdown_bench_1e5_rows():
    """Scale check: ~1e5 synthetic rows via sqlite JDBC pushdown."""
    n = 100_000
    engine = _memory_engine()
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE audience ("
                "member_id TEXT, tag_status_active INTEGER, "
                "tag_premium INTEGER, channel TEXT)"
            )
        )
        # Bulk insert in chunks
        batch = []
        for i in range(n):
            batch.append(
                {
                    "member_id": str(i),
                    "tag_status_active": 1 if i % 2 == 0 else 0,
                    "tag_premium": 1 if i % 5 == 0 else 0,
                    "channel": "app" if i % 3 == 0 else "web",
                }
            )
            if len(batch) >= 5000:
                conn.execute(
                    text(
                        "INSERT INTO audience "
                        "(member_id, tag_status_active, tag_premium, channel) "
                        "VALUES (:member_id, :tag_status_active, :tag_premium, :channel)"
                    ),
                    batch,
                )
                batch = []
        if batch:
            conn.execute(
                text(
                    "INSERT INTO audience "
                    "(member_id, tag_status_active, tag_premium, channel) "
                    "VALUES (:member_id, :tag_status_active, :tag_premium, :channel)"
                ),
                batch,
            )

    # Match fixture semantics: active AND (premium OR channel in app)
    query = {
        "op": "and",
        "args": [
            {"tag": "tag_status_active", "op": "eq", "value": True},
            {
                "op": "or",
                "args": [
                    {"tag": "tag_premium", "op": "eq", "value": True},
                    {"tag": "channel", "op": "in", "value": ["app"]},
                ],
            },
        ],
    }
    # Expected count: even i (active) AND (i%5==0 or i%3==0)
    expected = sum(
        1
        for i in range(n)
        if (i % 2 == 0) and ((i % 5 == 0) or (i % 3 == 0))
    )

    ch = JdbcChannel(name="jdbc_bench", engine=engine, dialect="sqlite")
    t0 = time.perf_counter()
    got = pushdown_select(
        ch, query, table="audience", id_field="member_id", dialect="sqlite", limit=n
    )
    elapsed = time.perf_counter() - t0
    assert len(got.ids) == expected
    # Loose latency bound — CI/laptops vary; fail only on pathological slowness
    assert elapsed < 15.0, f"bench too slow: {elapsed:.2f}s for {n} rows → {expected} hits"
    print(f"\n[H8 bench] n={n} hits={expected} elapsed={elapsed:.3f}s sql_len={len(got.sql)}")


def test_clickhouse_compile_only_no_live_client():
    """Live CH optional; dialect compile must still be stable."""
    query = {
        "op": "and",
        "args": [
            {"tag": "tag_status_active", "op": "eq", "value": True},
            {"tag": "channel", "op": "in", "value": ["app", "web"]},
        ],
    }
    sql = compile_audience_sql(query, table="audience", dialect="clickhouse")
    assert "tag_status_active = true" in sql
    assert "channel IN ('app', 'web')" in sql
    assert "INSERT" not in sql.upper()
    assert "DELETE" not in sql.upper()
