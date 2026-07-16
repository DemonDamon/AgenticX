import { describe, expect, it } from "vitest";
import { resolveDatabaseConfig } from "../config";

describe("resolveDatabaseConfig", () => {
  it("uses explicit postgresql + URL", () => {
    expect(
      resolveDatabaseConfig({
        DATABASE_DIALECT: "postgresql",
        DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
        NODE_ENV: "production",
      }),
    ).toEqual({
      dialect: "postgresql",
      url: "postgresql://u:p@127.0.0.1:5432/db?sslmode=disable",
    });
  });

  it("uses explicit mysql + URL", () => {
    expect(
      resolveDatabaseConfig({
        DATABASE_DIALECT: "mysql",
        DATABASE_URL: "mysql://u:p@127.0.0.1:3306/db",
        NODE_ENV: "production",
      }),
    ).toEqual({
      dialect: "mysql",
      url: "mysql://u:p@127.0.0.1:3306/db",
    });
  });

  it("infers postgresql from URL", () => {
    const cfg = resolveDatabaseConfig({
      DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
      NODE_ENV: "production",
    });
    expect(cfg.dialect).toBe("postgresql");
  });

  it("infers mysql from URL", () => {
    const cfg = resolveDatabaseConfig({
      DATABASE_URL: "mysql://u:p@127.0.0.1:3306/db",
      NODE_ENV: "production",
    });
    expect(cfg.dialect).toBe("mysql");
  });

  it("rejects dialect/URL mismatch mysql+pg", () => {
    expect(() =>
      resolveDatabaseConfig({
        DATABASE_DIALECT: "mysql",
        DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
        NODE_ENV: "production",
      }),
    ).toThrow();
  });

  it("rejects dialect/URL mismatch pg+mysql", () => {
    expect(() =>
      resolveDatabaseConfig({
        DATABASE_DIALECT: "postgresql",
        DATABASE_URL: "mysql://u:p@127.0.0.1:3306/db",
        NODE_ENV: "production",
      }),
    ).toThrow();
  });

  it("falls back to local PG URL outside production", () => {
    const cfg = resolveDatabaseConfig({
      NODE_ENV: "development",
    });
    expect(cfg.dialect).toBe("postgresql");
    expect(cfg.url).toContain("127.0.0.1:5432");
  });

  it("requires URL in production", () => {
    expect(() =>
      resolveDatabaseConfig({
        NODE_ENV: "production",
        DATABASE_DIALECT: "postgresql",
      }),
    ).toThrow(/DATABASE_URL/);
  });
});
