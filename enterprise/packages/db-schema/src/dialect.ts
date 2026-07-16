export const DATABASE_DIALECTS = ["postgresql", "mysql"] as const;

export type DatabaseDialect = (typeof DATABASE_DIALECTS)[number];

export type DialectResolveInput = {
  dialect?: string | null;
  databaseUrl?: string | null;
};

export type DialectResolveResult = {
  dialect: DatabaseDialect;
  databaseUrl: string;
};

const PG_URL_RE = /^(postgres(ql)?:\/\/)/i;
const MYSQL_URL_RE = /^mysql:\/\//i;

export function isDatabaseDialect(value: unknown): value is DatabaseDialect {
  return value === "postgresql" || value === "mysql";
}

export function inferDialectFromUrl(databaseUrl: string): DatabaseDialect | null {
  const url = databaseUrl.trim();
  if (!url) return null;
  if (PG_URL_RE.test(url)) return "postgresql";
  if (MYSQL_URL_RE.test(url)) return "mysql";
  return null;
}

/**
 * Resolve DATABASE_DIALECT + DATABASE_URL with strict cross-checks.
 * - dialect required (or inferable from URL when dialect omitted)
 * - URL scheme must match dialect
 */
export function resolveDatabaseDialect(
  input: DialectResolveInput = {},
): DialectResolveResult {
  const rawDialect = (input.dialect ?? process.env.DATABASE_DIALECT ?? "").trim();
  const databaseUrl = (input.databaseUrl ?? process.env.DATABASE_URL ?? "").trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const inferred = inferDialectFromUrl(databaseUrl);
  let dialect: DatabaseDialect;

  if (rawDialect) {
    if (!isDatabaseDialect(rawDialect)) {
      throw new Error(
        `Invalid DATABASE_DIALECT="${rawDialect}". Expected "postgresql" or "mysql".`,
      );
    }
    dialect = rawDialect;
  } else if (inferred) {
    dialect = inferred;
  } else {
    throw new Error(
      "DATABASE_DIALECT is required when DATABASE_URL scheme is not postgres(ql):// or mysql://",
    );
  }

  if (inferred && inferred !== dialect) {
    throw new Error(
      `DATABASE_DIALECT=${dialect} does not match DATABASE_URL scheme (inferred=${inferred})`,
    );
  }

  if (dialect === "postgresql" && !PG_URL_RE.test(databaseUrl)) {
    throw new Error(
      `DATABASE_DIALECT=postgresql requires a postgres:// or postgresql:// DATABASE_URL`,
    );
  }
  if (dialect === "mysql" && !MYSQL_URL_RE.test(databaseUrl)) {
    throw new Error(`DATABASE_DIALECT=mysql requires a mysql:// DATABASE_URL`);
  }

  return { dialect, databaseUrl };
}
