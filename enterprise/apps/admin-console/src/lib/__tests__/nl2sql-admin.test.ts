import { describe, expect, it } from "vitest";
import {
  CODE_INVALID_QUERY_MODE,
  CODE_WRITE_GUARD_DENIED,
  decideQueryMode,
  denialReasonZh,
  draftSqlFromQuestion,
  isReadOnlySql,
  runFixtureNl2Sql,
} from "../nl2sql-admin";

describe("nl2sql-admin fixture (W4 ↔ W2 contract)", () => {
  it("classifies read-only SQL", () => {
    expect(isReadOnlySql("SELECT 1")).toBe(true);
    expect(isReadOnlySql("  with t as (select 1) select * from t")).toBe(true);
    expect(isReadOnlySql("INSERT INTO t VALUES (1)")).toBe(false);
    expect(isReadOnlySql("")).toBe(false);
  });

  it("accepts explain|execute and rejects invalid mode", () => {
    expect(decideQueryMode("explain").allowed).toBe(true);
    expect(decideQueryMode("execute").allowed).toBe(true);
    expect(decideQueryMode(null).allowed).toBe(true);
    const denied = decideQueryMode("mutate");
    expect(denied.allowed).toBe(false);
    expect(denied.code).toBe(CODE_INVALID_QUERY_MODE);
  });

  it("explain returns SQL draft without rows", () => {
    const r = runFixtureNl2Sql({
      question: "上月华东大区 GMV 和退货率分别是多少？",
      mode: "explain",
    });
    expect(r.refused).toBe(false);
    expect(r.mode).toBe("explain");
    expect(r.executed).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r.channel_calls).toEqual([]);
    expect(r.sql.toUpperCase()).toContain("SELECT");
    expect(draftSqlFromQuestion("上月华东大区 GMV")).toContain("retail_monthly");
  });

  it("execute returns demo rows for retail question", () => {
    const r = runFixtureNl2Sql({
      question: "上月华东大区 GMV 和退货率分别是多少？",
      mode: "execute",
    });
    expect(r.refused).toBe(false);
    expect(r.executed).toBe(true);
    expect(r.rows[0]?.region).toBe("华东");
    expect(r.channel_calls?.[0]).toBe(r.sql);
  });

  it("execute denies non-readonly SQL with stable code", () => {
    const r = runFixtureNl2Sql({
      question: "写入",
      mode: "execute",
      sql: "INSERT INTO t VALUES (1)",
    });
    expect(r.refused).toBe(true);
    expect(r.executed).toBe(false);
    expect(r.code).toBe(CODE_WRITE_GUARD_DENIED);
    expect(r.reason || "").toContain(CODE_WRITE_GUARD_DENIED);
    expect(denialReasonZh(r.code, r.reason)).toContain("写闸已拒绝");
  });

  it("maps invalid mode to Chinese denial copy", () => {
    const r = runFixtureNl2Sql({ question: "q", mode: "mutate" });
    expect(r.code).toBe(CODE_INVALID_QUERY_MODE);
    expect(denialReasonZh(r.code, r.reason)).toContain("无效查询模式");
  });
});
