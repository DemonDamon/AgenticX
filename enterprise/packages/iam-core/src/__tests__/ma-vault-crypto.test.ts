import { describe, expect, it } from "vitest";

import {
  openSecretPayload,
  sealSecretPayload,
  VaultCryptoUnavailableError,
  VaultDecryptError,
} from "../ma-vault-crypto";

const KEY_A = "vault-master-key-A-0123456789abcdef";
const KEY_B = "vault-master-key-B-0123456789abcdef";
const PLAIN = { token: "tok-abcdefgh-123" }; // gitleaks:allow

/** Flip base64 symbols only in the last sextet — often a no-op on decoded bytes. */
function tamperSealedCiphertext(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, "base64url");
  expect(raw.length).toBeGreaterThan(32);
  // iv[0..11] tag[12..27] ciphertext[28..] — corrupt tag + payload so GCM must fail.
  for (const idx of [14, 15, 16, 30, 31, 32, raw.length - 1]) {
    raw[idx] = raw[idx]! ^ 0xff;
  }
  return raw.toString("base64url");
}

describe("ma vault crypto", () => {
  it("seal/open roundtrip", () => {
    const sealed = sealSecretPayload(PLAIN, { MA_VAULT_MASTER_KEY: KEY_A });
    expect(openSecretPayload(sealed, { MA_VAULT_MASTER_KEY: KEY_A })).toEqual(PLAIN);
  });

  it("ciphertext never contains plaintext", () => {
    const env = { MA_VAULT_MASTER_KEY: KEY_A };
    const first = sealSecretPayload(PLAIN, env);
    const second = sealSecretPayload(PLAIN, env);
    expect(first.ciphertext).not.toContain("tok-abcdefgh-123");
    expect(first.wrappedDek).not.toContain("tok-abcdefgh-123");
    expect(second.ciphertext).not.toContain("tok-abcdefgh-123");
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.wrappedDek).not.toBe(second.wrappedDek);
  });

  it("missing master key -> VaultCryptoUnavailableError", () => {
    expect(() => sealSecretPayload(PLAIN, {})).toThrow(VaultCryptoUnavailableError);
  });

  it("weak master key rejected", () => {
    expect(() => sealSecretPayload(PLAIN, { MA_VAULT_MASTER_KEY: "short" })).toThrow(VaultCryptoUnavailableError);
  });

  it("previous key fallback", () => {
    const sealed = sealSecretPayload(PLAIN, { MA_VAULT_MASTER_KEY: KEY_A });
    expect(openSecretPayload(sealed, { MA_VAULT_MASTER_KEY: KEY_B, MA_VAULT_MASTER_KEY_PREVIOUS: KEY_A })).toEqual(PLAIN);
    try {
      openSecretPayload(sealed, { MA_VAULT_MASTER_KEY: KEY_B });
      throw new Error("expected decrypt failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VaultDecryptError);
      expect(error instanceof Error ? error.message : "").toBe("cannot decrypt credential");
    }
  });

  it("tampered ciphertext -> VaultDecryptError", () => {
    const sealed = sealSecretPayload(PLAIN, { MA_VAULT_MASTER_KEY: KEY_A });
    const tampered = tamperSealedCiphertext(sealed.ciphertext);
    expect(tampered).not.toBe(sealed.ciphertext);
    expect(() => openSecretPayload({ ...sealed, ciphertext: tampered }, { MA_VAULT_MASTER_KEY: KEY_A })).toThrow(
      VaultDecryptError,
    );
  });
});
