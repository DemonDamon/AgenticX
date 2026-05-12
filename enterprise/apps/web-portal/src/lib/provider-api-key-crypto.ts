/** 与 admin-console 对齐：解密模型服务商密钥（服务端专用，不下发浏览器）。 */
import { createDecipheriv, createHash } from "node:crypto";

const PREFIX = "agx:gcm1:";

function deriveKeyMaterial(): Buffer {
  const configured = process.env.AGX_PROVIDER_SECRET_KEY?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AGX_PROVIDER_SECRET_KEY is required in production.");
    }
    return createHash("sha256").update("dev-agx-provider-secret-insecure").digest();
  }
  return createHash("sha256").update(configured).digest();
}

export function decryptProviderApiKey(ciphertext: string): string {
  const raw = ciphertext?.trim?.() ?? "";
  if (!raw) return "";
  if (!raw.startsWith(PREFIX)) {
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
