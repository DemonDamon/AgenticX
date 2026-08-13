import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  decryptProviderApiKey: vi.fn((value: string) => value),
}));

vi.mock("@agenticx/iam-core", () => ({
  resolveDatabaseConfig: () => ({
    dialect: "postgresql",
    url: "postgresql://test",
  }),
  createMysqlDb: vi.fn(),
  getIamDb: () => ({
    select: mocks.select,
    insert: mocks.insert,
  }),
}));

vi.mock("@agenticx/iam-core/provider-api-key-crypto", () => ({
  decryptProviderApiKeyStrict: (value: string) => mocks.decryptProviderApiKey(value),
  encryptProviderApiKey: (value: string) => value,
}));

import {
  getPublicWebSearchConfig,
  loadTenantWebSearchConfig,
  upsertTenantWebSearchConfig,
  WebSearchConfigValidationError,
} from "../tenant-config";

const STORED_ROW = {
  tenantId: "tenant-1",
  enabled: false,
  provider: "duckduckgo",
  apiKeyCipher: "encrypted-key",
  providers: [],
  maxResults: 50,
  maxSearchCalls: 3,
  deepResearchEnabled: true,
  updatedAt: new Date(),
};
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

function selectResult(result: unknown[] | Error) {
  const limit = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  mocks.select.mockReturnValue({ from });
}

describe("tenant web-search settings reads", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test";
    mocks.select.mockReset();
    mocks.insert.mockReset();
    mocks.decryptProviderApiKey.mockReset();
    mocks.decryptProviderApiKey.mockImplementation((value: string) => value);
  });

  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  });

  it("still returns defaults when the tenant genuinely has no settings row", async () => {
    selectResult([]);

    await expect(getPublicWebSearchConfig("tenant-1")).resolves.toMatchObject({
      enabled: true,
      maxSearchCalls: 3,
      deepResearchEnabled: true,
    });
  });

  it("does not show fake defaults when the database read fails", async () => {
    const readError = new Error("database unavailable");
    selectResult(readError);

    await expect(getPublicWebSearchConfig("tenant-1")).rejects.toBe(readError);
  });

  it("fails closed for ordinary search when tenant config cannot be read", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    selectResult(new Error("database unavailable"));

    await expect(loadTenantWebSearchConfig("tenant-1")).resolves.toMatchObject({
      enabled: false,
      providers: [],
      deepResearchEnabled: false,
    });
    warn.mockRestore();
  });

  it("does not show fake defaults when stored credentials cannot be decrypted", async () => {
    selectResult([STORED_ROW]);
    const decryptError = new Error("decrypt failed");
    mocks.decryptProviderApiKey.mockImplementation(() => {
      throw decryptError;
    });

    await expect(getPublicWebSearchConfig("tenant-1")).rejects.toBe(decryptError);
  });

  it("does not rebuild or overwrite settings after an existing-config read failure", async () => {
    const readError = new Error("database unavailable");
    selectResult(readError);

    await expect(
      upsertTenantWebSearchConfig("tenant-1", { maxSearchCalls: 4 }),
    ).rejects.toBe(readError);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("does not overwrite settings after an existing credential decrypt failure", async () => {
    selectResult([STORED_ROW]);
    const decryptError = new Error("decrypt failed");
    mocks.decryptProviderApiKey.mockImplementation(() => {
      throw decryptError;
    });

    await expect(
      upsertTenantWebSearchConfig("tenant-1", { maxSearchCalls: 4 }),
    ).rejects.toBe(decryptError);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("returns only the safe endpoint view while keeping credentials and arbitrary options private", async () => {
    selectResult([
      {
        ...STORED_ROW,
        provider: "doubao",
        providers: [
          {
            id: "tenant-search",
            adapter: "doubao",
            displayName: "Tenant search",
            apiKeyCipher: "encrypted-provider-key",
            enabled: true,
            priority: 0,
            options: {
              endpoint: "https://search.example/api",
              internalOnly: "must-not-leak",
            },
          },
        ],
      },
    ]);

    const config = await getPublicWebSearchConfig("tenant-1");

    expect(config.primaryProviderId).toBe("tenant-search");
    expect(config.providers[0]).toMatchObject({
      id: "tenant-search",
      adapter: "doubao",
      endpoint: "https://search.example/api",
      hasApiKey: true,
    });
    expect(JSON.stringify(config)).not.toContain("encrypted-provider-key");
    expect(JSON.stringify(config)).not.toContain("internalOnly");
  });

  it("reports the first actually configured provider as the effective primary", async () => {
    selectResult([
      {
        ...STORED_ROW,
        provider: "doubao",
        providers: [
          {
            id: "keyless-primary",
            adapter: "doubao",
            displayName: "Keyless",
            apiKeyCipher: "",
            enabled: true,
            priority: 0,
          },
          {
            id: "configured-fallback",
            adapter: "bocha",
            displayName: "Configured",
            apiKeyCipher: "configured-secret",
            enabled: true,
            priority: 1,
          },
        ],
      },
    ]);

    const config = await getPublicWebSearchConfig("tenant-1");

    expect(config.primaryProviderId).toBe("configured-fallback");
  });

  it("rejects unknown adapters and unsafe custom endpoints before any database write", async () => {
    selectResult([STORED_ROW]);

    await expect(
      upsertTenantWebSearchConfig("tenant-1", {
        providers: [
          {
            id: "unknown",
            adapter: "future-unknown-protocol",
            apiKey: "key",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(WebSearchConfigValidationError);
    await expect(
      upsertTenantWebSearchConfig("tenant-1", {
        providers: [
          {
            id: "unsafe",
            adapter: "doubao",
            apiKey: "key",
            options: { endpoint: "https://127.0.0.1/search" },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(WebSearchConfigValidationError);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("does not inherit credentials when the protocol changes under an existing id", async () => {
    selectResult([
      {
        ...STORED_ROW,
        provider: "bocha",
        providers: [
          {
            id: "tenant-search",
            adapter: "bocha",
            displayName: "Tenant search",
            apiKeyCipher: "old-secret",
            enabled: true,
            priority: 0,
            options: { endpoint: "https://old.example/search" },
          },
        ],
      },
    ]);
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn((value: unknown) => {
      void value;
      return { onConflictDoUpdate };
    });
    mocks.insert.mockReturnValue({ values });

    await upsertTenantWebSearchConfig("tenant-1", {
      providers: [
        {
          id: "tenant-search",
          adapter: "tavily",
          displayName: "Tenant search",
        },
      ],
    });

    const written = values.mock.calls[0]?.[0] as {
      providers: Array<{ apiKeyCipher: string; options?: unknown }>;
    };
    expect(written.providers[0]?.apiKeyCipher).toBe("");
    expect(written.providers[0]?.options).toBeUndefined();
  });

  it("clears the preserved credential when a custom endpoint changes", async () => {
    selectResult([
      {
        ...STORED_ROW,
        provider: "bocha",
        providers: [
          {
            id: "tenant-search",
            adapter: "bocha",
            displayName: "Tenant search",
            apiKeyCipher: "old-secret",
            enabled: true,
            priority: 0,
            options: { endpoint: "https://old.example/search" },
          },
        ],
      },
    ]);
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn((value: unknown) => {
      void value;
      return { onConflictDoUpdate };
    });
    mocks.insert.mockReturnValue({ values });

    await upsertTenantWebSearchConfig("tenant-1", {
      providers: [
        {
          id: "tenant-search",
          adapter: "bocha",
          displayName: "Tenant search",
          options: { endpoint: "https://new.example/search" },
        },
      ],
    });

    const written = values.mock.calls[0]?.[0] as {
      providers: Array<{ apiKeyCipher: string; options?: { endpoint?: string } }>;
    };
    expect(written.providers[0]?.apiKeyCipher).toBe("");
    expect(written.providers[0]?.options?.endpoint).toBe("https://new.example/search");
  });
});
