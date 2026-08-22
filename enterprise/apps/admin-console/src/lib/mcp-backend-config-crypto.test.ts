import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BACKEND_CONFIG_CIPHER_KEY,
  decryptBackendConfig,
  encryptBackendConfig,
  isEncryptedBackendConfig,
} from "./mcp-backend-config-crypto";

const ORIGINAL_SECRET = process.env.AGX_PROVIDER_SECRET_KEY;

beforeAll(() => {
  process.env.AGX_PROVIDER_SECRET_KEY = "test-provider-secret";
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.AGX_PROVIDER_SECRET_KEY;
  else process.env.AGX_PROVIDER_SECRET_KEY = ORIGINAL_SECRET;
});

describe("encryptBackendConfig", () => {
  it("round-trips the config and keeps no plaintext in the stored row", () => {
    const config = {
      base_url: "https://data.example.com",
      api_key: "sk-market-data-123",
      headers: { "X-Seat": "42" },
    };
    const stored = encryptBackendConfig(config);

    expect(isEncryptedBackendConfig(stored)).toBe(true);
    expect(Object.keys(stored)).toEqual([BACKEND_CONFIG_CIPHER_KEY]);
    // 整份配置都在密文里，凭据不会以任何形式留在 jsonb 的可读字段上。
    expect(JSON.stringify(stored)).not.toContain("sk-market-data-123");
    expect(JSON.stringify(stored)).not.toContain("data.example.com");
    expect(decryptBackendConfig(stored)).toEqual(config);
  });

  it("leaves an empty config alone instead of storing a ciphertext blob", () => {
    expect(encryptBackendConfig({})).toEqual({});
    expect(encryptBackendConfig(undefined)).toEqual({});
  });

  it("does not double-encrypt an already-sealed row", () => {
    const once = encryptBackendConfig({ api_key: "k" });
    const twice = encryptBackendConfig(once);
    // 二次加密会让原始结构再也解不出来，这里必须原样返回。
    expect(twice).toEqual(once);
    expect(decryptBackendConfig(twice)).toEqual({ api_key: "k" });
  });
});

describe("decryptBackendConfig", () => {
  it("passes through rows written before encryption shipped", () => {
    const legacy = { base_url: "https://legacy.example.com", api_key: "plain-key" };
    expect(decryptBackendConfig(legacy)).toEqual(legacy);
  });

  it("yields nothing when the ciphertext cannot be opened", () => {
    // 保留信封会让调用方把 __agx_cipher 当成一个普通配置字段发给上游。
    const broken = { [BACKEND_CONFIG_CIPHER_KEY]: "agx:gcm1:aaa.bbb.ccc" };
    expect(decryptBackendConfig(broken)).toEqual({});
  });

  it("tolerates junk rows", () => {
    for (const bad of [undefined, null, "x", 3, [1, 2]]) {
      expect(decryptBackendConfig(bad)).toEqual({});
    }
  });
});
