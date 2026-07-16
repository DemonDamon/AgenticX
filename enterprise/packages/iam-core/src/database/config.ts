import {
  isDatabaseDialect,
  resolveDatabaseDialect,
  type DatabaseDialect,
} from "@agenticx/db-schema";

export type { DatabaseDialect };

export type DatabaseConfig =
  | { dialect: "postgresql"; url: string }
  | { dialect: "mysql"; url: string };

export type ResolveDatabaseConfigInput = {
  DATABASE_DIALECT?: string;
  DATABASE_URL?: string;
  NODE_ENV?: string;
};

const DEFAULT_PG_URL = "postgresql://postgres:postgres@127.0.0.1:5432/agenticx";

/**
 * Resolve DATABASE_DIALECT + DATABASE_URL for IAM/runtime packages.
 * Missing dialect may be inferred from postgres(ql):// or mysql:// URL.
 * In non-production, missing URL falls back to local PostgreSQL (legacy behavior).
 */
export function resolveDatabaseConfig(
  env: ResolveDatabaseConfigInput = process.env,
): DatabaseConfig {
  const nodeEnv = env.NODE_ENV ?? process.env.NODE_ENV;
  let databaseUrl = (env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    if (nodeEnv !== "production") {
      databaseUrl = DEFAULT_PG_URL;
    } else {
      throw new Error("DATABASE_URL is not configured");
    }
  }

  // Preserve historical PG sslmode=disable injection for local URLs without sslmode.
  if (/^postgres(ql)?:\/\//i.test(databaseUrl) && !/sslmode=/i.test(databaseUrl)) {
    const joiner = databaseUrl.includes("?") ? "&" : "?";
    databaseUrl = `${databaseUrl}${joiner}sslmode=disable`;
  }

  const resolved = resolveDatabaseDialect({
    dialect: env.DATABASE_DIALECT,
    databaseUrl,
  });

  if (!isDatabaseDialect(resolved.dialect)) {
    const _exhaustive: never = resolved.dialect;
    throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
  }

  switch (resolved.dialect) {
    case "postgresql":
      return { dialect: "postgresql", url: resolved.databaseUrl };
    case "mysql":
      return { dialect: "mysql", url: resolved.databaseUrl };
    default: {
      const _exhaustive: never = resolved.dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
