import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptProviderApiKey,
  decryptProviderApiKeyStrict,
  encryptProviderApiKey,
} from "./provider-api-key-crypto";

const ORIGINAL_SECRET = process.env.AGX_PROVIDER_SECRET_KEY;

describe("provider API key crypto", () => {
  beforeEach(() => {
    process.env.AGX_PROVIDER_SECRET_KEY = "test-provider-secret";
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.AGX_PROVIDER_SECRET_KEY;
    else process.env.AGX_PROVIDER_SECRET_KEY = ORIGINAL_SECRET;
  });

  it("round-trips authenticated ciphertext", () => {
    const ciphertext = encryptProviderApiKey("tenant-search-key");

    expect(decryptProviderApiKeyStrict(ciphertext)).toBe("tenant-search-key");
  });

  it("fails closed when a versioned ciphertext is corrupted", () => {
    const ciphertext = encryptProviderApiKey("tenant-search-key");
    const lastDot = ciphertext.lastIndexOf(".");
    const tag = ciphertext.slice(lastDot + 1);
    const corrupted = `${ciphertext.slice(0, lastDot + 1)}${tag.startsWith("A") ? "B" : "A"}${tag.slice(1)}`;

    expect(decryptProviderApiKey(corrupted)).toBe("");
    expect(() => decryptProviderApiKeyStrict(corrupted)).toThrow(/decryption failed/i);
  });

  it("keeps empty and explicit legacy plaintext values compatible", () => {
    expect(decryptProviderApiKeyStrict("")).toBe("");
    expect(decryptProviderApiKeyStrict("legacy-plaintext-key")).toBe(
      "legacy-plaintext-key",
    );
  });
});
