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
  decryptProviderApiKey: (value: string) => mocks.decryptProviderApiKey(value),
  encryptProviderApiKey: (value: string) => value,
}));

import {
  getPublicWebSearchConfig,
  upsertTenantWebSearchConfig,
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
});
