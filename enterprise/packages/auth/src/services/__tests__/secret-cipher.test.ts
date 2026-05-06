import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../secret-cipher";

describe("secret-cipher", () => {
  it("encrypts and decrypts value", () => {
    const key = randomBytes(32).toString("hex");
    const encrypted = encryptSecret("client-secret-123", key);
    expect(encrypted).not.toContain("client-secret-123");
    expect(decryptSecret(encrypted, key)).toBe("client-secret-123");
  });
});
