import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSecretFromEnv } from "../secret-from-env";

describe("readSecretFromEnv", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "secret-from-env-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prefers the bare variable", () => {
    const path = join(dir, "key.pem");
    writeFileSync(path, "from-file");
    expect(
      readSecretFromEnv("AUTH_JWT_PRIVATE_KEY", {
        AUTH_JWT_PRIVATE_KEY: "from-env",
        AUTH_JWT_PRIVATE_KEY_FILE: path,
      }),
    ).toBe("from-env");
  });

  it("falls back to the path in <NAME>_FILE", () => {
    const path = join(dir, "key.pem");
    writeFileSync(path, "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n");
    expect(readSecretFromEnv("AUTH_JWT_PRIVATE_KEY", { AUTH_JWT_PRIVATE_KEY_FILE: path })).toBe(
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    );
  });

  it("strips only the trailing newline so PEM bodies survive", () => {
    const path = join(dir, "token");
    writeFileSync(path, "deadbeef\n");
    expect(readSecretFromEnv("GATEWAY_INTERNAL_TOKEN", { GATEWAY_INTERNAL_TOKEN_FILE: path })).toBe(
      "deadbeef",
    );
  });

  it("treats a blank bare variable as unset", () => {
    const path = join(dir, "key.pem");
    writeFileSync(path, "from-file");
    expect(
      readSecretFromEnv("AUTH_JWT_PRIVATE_KEY", {
        AUTH_JWT_PRIVATE_KEY: "   ",
        AUTH_JWT_PRIVATE_KEY_FILE: path,
      }),
    ).toBe("from-file");
  });

  it("returns undefined when neither form is configured", () => {
    expect(readSecretFromEnv("AUTH_JWT_PRIVATE_KEY", {})).toBeUndefined();
  });

  it("names the offending variable when the path cannot be read", () => {
    // 退化成「密钥未配置」会让人去查一个其实配对了的变量。
    expect(() =>
      readSecretFromEnv("AUTH_JWT_PRIVATE_KEY", {
        AUTH_JWT_PRIVATE_KEY_FILE: join(dir, "missing.pem"),
      }),
    ).toThrow(/AUTH_JWT_PRIVATE_KEY_FILE points at an unreadable path/);
  });
});
