import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "agx:gcm1:";

function deriveKeyMaterial(): Buffer {
  const configured = process.env.AGX_PROVIDER_SECRET_KEY?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AGX_PROVIDER_SECRET_KEY is required in production to encrypt model provider API keys.");
    }
    return createHash("sha256").update("dev-agx-provider-secret-insecure").digest();
  }
  return createHash("sha256").update(configured).digest();
}

/** 加密明文 API Key；空串返回空串。 */
export function encryptProviderApiKey(plaintext: string): string {
  if (!plaintext.trim()) return "";
  const key = deriveKeyMaterial();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${enc.toString("base64url")}.${tag.toString("base64url")}`;
}

/** 解密为空串或无密文视作无 Key。 */
export function decryptProviderApiKey(ciphertext: string): string {
  const raw = ciphertext?.trim?.() ?? "";
  if (!raw) return "";
  if (!raw.startsWith(PREFIX)) {
    /** 兼容明文旧数据迁移：若看起来像密文前缀则报错，否则当明文兜底 */
    if (raw.includes("base64")) return "";
    return raw;
  }
  const payload = raw.slice(PREFIX.length);
  const parts = payload.split(".");
  if (parts.length !== 3) return "";
  try {
    const iv = Buffer.from(parts[0]!, "base64url");
    const enc = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    const key = deriveKeyMaterial();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
