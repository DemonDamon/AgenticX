import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const HKDF_HASH = "sha256";
const HKDF_SALT = "agenticx.sso.secret-cipher.v1";
const HKDF_INFO = "aes-256-gcm.key";
const KEY_LENGTH_BYTES = 32;
export const MIN_SECRET_KEY_LENGTH = 32;

export class WeakSecretKeyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WeakSecretKeyError";
  }
}

export function assertStrongSecretKey(secretKey: string, label = "secret key"): void {
  const trimmed = (secretKey ?? "").trim();
  if (trimmed.length < MIN_SECRET_KEY_LENGTH) {
    throw new WeakSecretKeyError(
      `${label} must be at least ${MIN_SECRET_KEY_LENGTH} bytes (use \`openssl rand -base64 32\` to generate).`
    );
  }
  const distinct = new Set(trimmed).size;
  if (distinct < 8) {
    throw new WeakSecretKeyError(
      `${label} entropy is too low (only ${distinct} distinct characters); generate a fresh random secret.`
    );
  }
}

function deriveKey(secret: string): Buffer {
  assertStrongSecretKey(secret);
  const derived = hkdfSync(HKDF_HASH, secret, HKDF_SALT, HKDF_INFO, KEY_LENGTH_BYTES);
  return Buffer.from(derived as ArrayBuffer);
}

export function encryptSecret(plainText: string, secretKey: string): string {
  const iv = randomBytes(12);
  const key = deriveKey(secretKey);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptSecret(cipherText: string, secretKey: string): string {
  const raw = Buffer.from(cipherText, "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const key = deriveKey(secretKey);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plain.toString("utf8");
}
