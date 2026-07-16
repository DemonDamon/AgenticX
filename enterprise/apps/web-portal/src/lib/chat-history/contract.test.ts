import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const pgCreate = vi.fn(async () => ({ id: "pg" }));
const mysqlCreate = vi.fn(async () => ({ id: "mysql" }));

vi.mock("./postgresql", () => ({
  postgresqlChatHistoryStore: {
    createChatSession: pgCreate,
  },
}));

vi.mock("./mysql", () => ({
  mysqlChatHistoryStore: {
    createChatSession: mysqlCreate,
  },
}));

describe("chat-history facade dialect contract", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.DATABASE_DIALECT;
    delete process.env.DATABASE_URL;
  });

  it.each([
    ["postgresql", "postgresql://localhost/agenticx", "pg"],
    ["mysql", "mysql://localhost/agenticx", "mysql"],
  ] as const)("dispatches %s to its adapter", async (dialect, url, expectedId) => {
    process.env.DATABASE_DIALECT = dialect;
    process.env.DATABASE_URL = url;
    const facade = await import("../chat-history");

    const result = await facade.createChatSession(
      { tenantId: "tenant", userId: "user" },
      { title: "title" },
    );

    expect(result.id).toBe(expectedId);
  });

  it("keeps the PostgreSQL compatibility alias", async () => {
    process.env.DATABASE_DIALECT = "postgresql";
    process.env.DATABASE_URL = "postgresql://localhost/agenticx";
    const facade = await import("../chat-history");

    expect(facade.syncAuthUserToPostgres).toBe(facade.syncAuthUserToDatabase);
  });
});
