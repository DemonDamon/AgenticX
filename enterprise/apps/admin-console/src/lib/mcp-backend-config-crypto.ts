/**
 * MCP `backend_config` 的静态加密。
 *
 * 这一列存的是上游凭据（API Key、Bearer token、basic auth 等），此前是明文入库的。
 * 复用 provider Key 那套 `agx:gcm1:` 信封（AES-256-GCM，同一份 AGX_PROVIDER_SECRET_KEY），
 * 不另造密码学：网关 Go 侧按同一信封解密，见 mcphost/secret_envelope.go。
 *
 * 列类型仍是 jsonb，加密后存成 `{ "__agx_cipher": "agx:gcm1:..." }`，
 * 因此不需要迁移；没有该键的历史行按明文读取，写入时自动转成密文。
 */

import { decryptProviderApiKey, encryptProviderApiKey } from "./provider-api-key-crypto";

/** 密文信封在 jsonb 里的键名；与 Go 侧 backendConfigCipherKey 必须一致。 */
export const BACKEND_CONFIG_CIPHER_KEY = "__agx_cipher";

export function isEncryptedBackendConfig(stored: unknown): boolean {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return false;
  return typeof (stored as Record<string, unknown>)[BACKEND_CONFIG_CIPHER_KEY] === "string";
}

/** 落库前加密。空配置不加密，避免把 `{}` 也变成一坨密文。 */
export function encryptBackendConfig(config: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  if (Object.keys(config).length === 0) return {};
  // 已是密文信封时原样返回，避免重复加密后再也解不出原始结构。
  if (isEncryptedBackendConfig(config)) return { ...config };
  return { [BACKEND_CONFIG_CIPHER_KEY]: encryptProviderApiKey(JSON.stringify(config)) };
}

/**
 * 读库后解密；历史明文行原样返回。
 *
 * 解不开时返回空对象而不是保留密文信封——把 `__agx_cipher` 泄漏到调用方
 * 会让它当成一个普通配置字段发给上游。
 */
export function decryptBackendConfig(stored: unknown): Record<string, unknown> {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const row = stored as Record<string, unknown>;
  const cipher = row[BACKEND_CONFIG_CIPHER_KEY];
  if (typeof cipher !== "string") return { ...row };
  const plain = decryptProviderApiKey(cipher);
  if (!plain) return {};
  try {
    const parsed = JSON.parse(plain) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
