import { describe, expect, it } from "vitest";
import {
  inferDialectFromUrl,
  isDatabaseDialect,
  resolveDatabaseDialect,
} from "../../../packages/db-schema/src/dialect";

describe("dialect contract", () => {
  it("accepts explicit postgresql + postgres URL", () => {
    const result = resolveDatabaseDialect({
      dialect: "postgresql",
      databaseUrl: "postgresql://u:p@127.0.0.1:5432/agenticx",
    });
    expect(result.dialect).toBe("postgresql");
  });

  it("accepts explicit mysql + mysql URL", () => {
    const result = resolveDatabaseDialect({
      dialect: "mysql",
      databaseUrl: "mysql://u:p@127.0.0.1:3306/agenticx",
    });
    expect(result.dialect).toBe("mysql");
  });

  it("infers postgresql from URL when dialect omitted", () => {
    const result = resolveDatabaseDialect({
      dialect: "",
      databaseUrl: "postgres://u:p@127.0.0.1:5432/agenticx",
    });
    expect(result.dialect).toBe("postgresql");
  });

  it("infers mysql from URL when dialect omitted", () => {
    const result = resolveDatabaseDialect({
      dialect: "",
      databaseUrl: "mysql://u:p@127.0.0.1:3306/agenticx",
    });
    expect(result.dialect).toBe("mysql");
  });

  it("rejects mysql dialect with postgres URL", () => {
    expect(() =>
      resolveDatabaseDialect({
        dialect: "mysql",
        databaseUrl: "postgresql://u:p@127.0.0.1:5432/agenticx",
      }),
    ).toThrow(/does not match|requires a mysql/i);
  });

  it("rejects postgresql dialect with mysql URL", () => {
    expect(() =>
      resolveDatabaseDialect({
        dialect: "postgresql",
        databaseUrl: "mysql://u:p@127.0.0.1:3306/agenticx",
      }),
    ).toThrow(/does not match|requires a postgres/i);
  });

  it("rejects unknown dialect", () => {
    expect(() =>
      resolveDatabaseDialect({
        dialect: "mariadb",
        databaseUrl: "mysql://u:p@127.0.0.1:3306/agenticx",
      }),
    ).toThrow(/Invalid DATABASE_DIALECT/);
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() =>
      resolveDatabaseDialect({
        dialect: "postgresql",
        databaseUrl: "",
      }),
    ).toThrow(/DATABASE_URL is required/);
  });

  it("type guards dialects", () => {
    expect(isDatabaseDialect("postgresql")).toBe(true);
    expect(isDatabaseDialect("mysql")).toBe(true);
    expect(isDatabaseDialect("sqlite")).toBe(false);
  });

  it("infers dialect helpers", () => {
    expect(inferDialectFromUrl("postgresql://x")).toBe("postgresql");
    expect(inferDialectFromUrl("mysql://x")).toBe("mysql");
    expect(inferDialectFromUrl("redis://x")).toBeNull();
  });
});
