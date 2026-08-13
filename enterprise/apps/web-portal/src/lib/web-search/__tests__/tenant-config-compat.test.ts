import { describe, expect, it, vi } from "vitest";

import {
  isMissingMaxSearchCallsColumnError,
  isMissingProviderPoolColumnError,
  mapStoredWebSearchConfigRow,
  readWebSearchConfigWithLegacyColumnFallback,
} from "../tenant-config";

const LEGACY_ROW = {
  enabled: false,
  provider: "duckduckgo",
  apiKeyCipher: "",
  providers: [],
  maxResults: 12,
  deepResearchEnabled: false,
};

const PRE_PROVIDER_POOL_ROW = {
  enabled: true,
  provider: "bocha",
  apiKeyCipher: "legacy-bocha-key",
  maxResults: 50,
  deepResearchEnabled: true,
};

describe("tenant web-search rolling schema compatibility", () => {
  it("recognizes PostgreSQL undefined_column for max_search_calls through a wrapped cause", () => {
    expect(
      isMissingMaxSearchCallsColumnError({
        message: "Failed query",
        cause: {
          code: "42703",
          message: 'column "max_search_calls" does not exist',
        },
      }),
    ).toBe(true);
  });

  it.each([
    {
      code: "ER_BAD_FIELD_ERROR",
      errno: 1054,
      sqlMessage: "Unknown column 'max_search_calls' in 'field list'",
    },
    {
      errno: 1054,
      message: "Unknown column 'enterprise_runtime_web_search.max_search_calls'",
    },
  ])("recognizes MySQL bad-field errors for max_search_calls", (error) => {
    expect(isMissingMaxSearchCallsColumnError(error)).toBe(true);
  });

  it.each([
    { code: "42703", message: 'column "providers" does not exist' },
    {
      code: "ER_BAD_FIELD_ERROR",
      errno: 1054,
      sqlMessage: "Unknown column 'enterprise_runtime_web_search.providers' in 'field list'",
    },
  ])("recognizes the provider-pool rolling schema error", (error) => {
    expect(isMissingProviderPoolColumnError(error)).toBe(true);
  });

  it.each([
    { errno: 1054, message: "Unknown column 'deep_research_enabled'" },
    { code: "ECONNREFUSED", message: "connect refused for max_search_calls" },
    { message: "column max_search_calls does not exist" },
  ])("does not classify unrelated database errors as the rolling fallback", (error) => {
    expect(isMissingMaxSearchCallsColumnError(error)).toBe(false);
  });

  it("retries the explicit legacy read and maps its real tenant policy with budget 3", async () => {
    const currentError = {
      code: "42703",
      message: 'column "max_search_calls" does not exist',
    };
    const readCurrent = vi.fn().mockRejectedValue(currentError);
    const readLegacy = vi.fn().mockResolvedValue([LEGACY_ROW]);

    const result = await readWebSearchConfigWithLegacyColumnFallback(
      readCurrent,
      readLegacy,
    );
    const mapped = mapStoredWebSearchConfigRow(
      result.rows[0]!,
      result.usedLegacySearchCallBudget,
    );

    expect(readLegacy).toHaveBeenCalledOnce();
    expect(mapped).toMatchObject({
      enabled: false,
      provider: "duckduckgo",
      maxResults: 12,
      maxSearchCalls: 3,
      deepResearchEnabled: false,
    });
  });

  it("does not retry or hide a non-target database error", async () => {
    const currentError = { code: "08006", message: "connection failure" };
    const readLegacy = vi.fn();

    await expect(
      readWebSearchConfigWithLegacyColumnFallback(
        vi.fn().mockRejectedValue(currentError),
        readLegacy,
      ),
    ).rejects.toBe(currentError);
    expect(readLegacy).not.toHaveBeenCalled();
  });

  it("uses the migrated value without executing the legacy read", async () => {
    const readLegacy = vi.fn();
    const result = await readWebSearchConfigWithLegacyColumnFallback(
      vi.fn().mockResolvedValue([{ ...LEGACY_ROW, maxSearchCalls: 5 }]),
      readLegacy,
    );
    const mapped = mapStoredWebSearchConfigRow(
      result.rows[0]!,
      result.usedLegacySearchCallBudget,
    );

    expect(readLegacy).not.toHaveBeenCalled();
    expect(mapped.maxSearchCalls).toBe(5);
  });

  it("preserves the legacy provider and key when the provider-pool column is absent", async () => {
    const readBeforeSearchBudget = vi.fn();
    const readBeforeProviderPool = vi.fn().mockResolvedValue([PRE_PROVIDER_POOL_ROW]);
    const result = await readWebSearchConfigWithLegacyColumnFallback(
      vi.fn().mockRejectedValue({
        code: "ER_BAD_FIELD_ERROR",
        errno: 1054,
        sqlMessage: "Unknown column 'providers' in 'field list'",
      }),
      readBeforeSearchBudget,
      readBeforeProviderPool,
    );
    const mapped = mapStoredWebSearchConfigRow(
      result.rows[0]!,
      result.usedLegacySearchCallBudget || result.usedLegacyProviderPool,
    );

    expect(readBeforeSearchBudget).not.toHaveBeenCalled();
    expect(readBeforeProviderPool).toHaveBeenCalledOnce();
    expect(result.usedLegacyProviderPool).toBe(true);
    expect(mapped).toMatchObject({
      enabled: true,
      provider: "bocha",
      apiKey: "legacy-bocha-key",
      providers: [],
      maxResults: 50,
      maxSearchCalls: 3,
      deepResearchEnabled: true,
    });
  });

  it("falls back across both rolling columns when the database is two migrations behind", async () => {
    const readBeforeSearchBudget = vi.fn().mockRejectedValue({
      code: "42703",
      message: 'column "providers" does not exist',
    });
    const readBeforeProviderPool = vi.fn().mockResolvedValue([PRE_PROVIDER_POOL_ROW]);

    const result = await readWebSearchConfigWithLegacyColumnFallback(
      vi.fn().mockRejectedValue({
        code: "42703",
        message: 'column "max_search_calls" does not exist',
      }),
      readBeforeSearchBudget,
      readBeforeProviderPool,
    );

    expect(readBeforeSearchBudget).toHaveBeenCalledOnce();
    expect(readBeforeProviderPool).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      usedLegacySearchCallBudget: true,
      usedLegacyProviderPool: true,
    });
  });

  it("does not hide a connectivity failure from a legacy-column read", async () => {
    const connectionError = { code: "ECONNRESET", message: "connection reset" };
    const readBeforeProviderPool = vi.fn();

    await expect(
      readWebSearchConfigWithLegacyColumnFallback(
        vi.fn().mockRejectedValue({
          code: "42703",
          message: 'column "max_search_calls" does not exist',
        }),
        vi.fn().mockRejectedValue(connectionError),
        readBeforeProviderPool,
      ),
    ).rejects.toBe(connectionError);
    expect(readBeforeProviderPool).not.toHaveBeenCalled();
  });

  it("propagates a failure from the oldest supported schema read", async () => {
    const connectionError = { code: "ETIMEDOUT", message: "query timed out" };

    await expect(
      readWebSearchConfigWithLegacyColumnFallback(
        vi.fn().mockRejectedValue({
          code: "ER_BAD_FIELD_ERROR",
          errno: 1054,
          message: "Unknown column 'providers'",
        }),
        vi.fn(),
        vi.fn().mockRejectedValue(connectionError),
      ),
    ).rejects.toBe(connectionError);
  });
});
