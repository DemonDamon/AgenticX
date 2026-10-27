import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMaInternalTokenCacheForTests, isMaInternalAuthorized } from "../internal-auth";

function bearer(token: string): Request {
  return new Request("http://localhost/api/internal/ma/pat-introspect", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("ma internal auth", () => {
  beforeEach(() => {
    __resetMaInternalTokenCacheForTests();
    vi.stubEnv("MA_INTERNAL_TOKEN", "");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", "");
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "");
  });

  afterEach(() => {
    __resetMaInternalTokenCacheForTests();
    vi.unstubAllEnvs();
  });

  it("rejects when MA_INTERNAL_TOKEN is unset", () => {
    vi.stubEnv("MA_INTERNAL_TOKEN", "");
    __resetMaInternalTokenCacheForTests();
    expect(isMaInternalAuthorized(bearer("anything"))).toBe(false);
  });

  it("accepts the exact bearer token", () => {
    vi.stubEnv("MA_INTERNAL_TOKEN", "abcdef");
    __resetMaInternalTokenCacheForTests();
    expect(isMaInternalAuthorized(bearer("abcdef"))).toBe(true);
  });

  it("rejects a different token of the same length", () => {
    vi.stubEnv("MA_INTERNAL_TOKEN", "abcdef");
    __resetMaInternalTokenCacheForTests();
    expect(isMaInternalAuthorized(bearer("abcdeg"))).toBe(false);
  });

  it("rejects a token of different length without throwing", () => {
    vi.stubEnv("MA_INTERNAL_TOKEN", "abcdef");
    __resetMaInternalTokenCacheForTests();
    expect(isMaInternalAuthorized(bearer("abc"))).toBe(false);
  });

  it("reads MA_INTERNAL_TOKEN_FILE", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ma-token-"));
    const file = path.join(dir, "token");
    writeFileSync(file, "from-file-token\n");
    vi.stubEnv("MA_INTERNAL_TOKEN", "");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", file);
    __resetMaInternalTokenCacheForTests();
    expect(isMaInternalAuthorized(bearer("from-file-token"))).toBe(true);
  });

  it("does not accept GATEWAY_INTERNAL_TOKEN", () => {
    vi.stubEnv("MA_INTERNAL_TOKEN", "");
    vi.stubEnv("MA_INTERNAL_TOKEN_FILE", "");
    vi.stubEnv("GATEWAY_INTERNAL_TOKEN", "gateway-token");
    __resetMaInternalTokenCacheForTests();
    expect(isMaInternalAuthorized(bearer("gateway-token"))).toBe(false);
  });
});
