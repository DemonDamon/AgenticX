import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * 跨语言信封：TS 这一侧的守卫。
 *
 * 网关（Go）解的就是这里加密出来的东西。样本放在网关的 testdata 里，两边测试读同一个
 * 文件——路径跨了目录树是有意的，样本只能有一份。
 *
 * 以前只有 Go 那边盯着它。那半边只能发现「Go 解不开 TS 产出的密文」；TS 自己改了信封
 * 格式的话，那段样本变成一段历史数据，Go 照样解得开，两边测试全绿，而生产上新写入的
 * 密文网关一个都读不了。最早的症状是 MCP 连不上上游，且看不出是解密问题。
 */
describe("cross-language secret envelope", () => {
  const sample = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../apps/gateway/internal/mcphost/testdata/cross_language_envelope.json",
      ),
      "utf8",
    ),
  ) as { secret: string; plaintext: string; ciphertext: string };

  beforeEach(() => {
    process.env.AGX_PROVIDER_SECRET_KEY = sample.secret;
  });

  it("still reads the sample the gateway is pinned to", () => {
    expect(decryptProviderApiKeyStrict(sample.ciphertext)).toBe(sample.plaintext);
  });

  it("still produces that same envelope shape", () => {
    // 光验解密不够：解密往往向后兼容，格式变了旧密文照样读得出来。产出这一侧也要钉住，
    // 否则改了格式之后，网关读不了的是**新**写入的那些。
    const [prefix, payload] = [
      encryptProviderApiKey(sample.plaintext).slice(0, "agx:gcm1:".length),
      encryptProviderApiKey(sample.plaintext).slice("agx:gcm1:".length),
    ];
    expect(prefix).toBe("agx:gcm1:");
    const parts = payload.split(".");
    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[0]!, "base64url").byteLength).toBe(12); // GCM nonce
    expect(Buffer.from(parts[2]!, "base64url").byteLength).toBe(16); // GCM tag
    expect(payload).not.toMatch(/[+/=]/); // base64url，不是标准 base64
  });
});
