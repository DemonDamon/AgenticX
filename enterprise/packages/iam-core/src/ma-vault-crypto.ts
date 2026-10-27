import { createHash, randomBytes } from "node:crypto";
import { assertStrongSecretKey, decryptSecret, encryptSecret, readSecretFromEnv } from "@agenticx/auth";

export const MA_VAULT_MASTER_KEY_ENV = "MA_VAULT_MASTER_KEY";
export const MA_VAULT_MASTER_KEY_PREVIOUS_ENV = "MA_VAULT_MASTER_KEY_PREVIOUS";

export class VaultCryptoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultCryptoUnavailableError";
  }
}

export class VaultDecryptError extends Error {
  credentialId?: string;

  constructor(message: string) {
    super(message);
    this.name = "VaultDecryptError";
  }
}

export type SealedSecret = { ciphertext: string; wrappedDek: string; kekId: string };

export function kekIdOf(masterKey: string): string {
  return createHash("sha256").update(masterKey).digest("hex").slice(0, 16);
}

function readOne(name: string, env: NodeJS.ProcessEnv): string | undefined {
  try {
    return readSecretFromEnv(name, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreadable secret";
    throw new VaultCryptoUnavailableError(message);
  }
}

export function readMasterKeys(env: NodeJS.ProcessEnv = process.env): { current: string; previous: string | null } {
  const current = readOne(MA_VAULT_MASTER_KEY_ENV, env);
  if (!current) {
    throw new VaultCryptoUnavailableError("MA_VAULT_MASTER_KEY is not configured");
  }
  try {
    assertStrongSecretKey(current, "MA_VAULT_MASTER_KEY");
  } catch (error) {
    throw new VaultCryptoUnavailableError(error instanceof Error ? error.message : "weak master key");
  }
  const previousRaw = readOne(MA_VAULT_MASTER_KEY_PREVIOUS_ENV, env);
  if (!previousRaw) return { current, previous: null };
  try {
    assertStrongSecretKey(previousRaw, "MA_VAULT_MASTER_KEY_PREVIOUS");
  } catch (error) {
    throw new VaultCryptoUnavailableError(error instanceof Error ? error.message : "weak previous master key");
  }
  return { current, previous: previousRaw };
}

function sortKeys(secrets: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(secrets).sort()) {
    out[key] = secrets[key] ?? "";
  }
  return out;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}

export function sealSecretPayload(secrets: Record<string, string>, env?: NodeJS.ProcessEnv): SealedSecret {
  const { current } = readMasterKeys(env);
  let dek = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = randomBytes(32).toString("base64url");
    if (new Set(candidate).size >= 8) {
      dek = candidate;
      break;
    }
  }
  if (!dek) throw new VaultCryptoUnavailableError("failed to generate data key");
  const ciphertext = encryptSecret(JSON.stringify(sortKeys(secrets)), dek);
  const wrappedDek = encryptSecret(dek, current);
  return { ciphertext, wrappedDek, kekId: kekIdOf(current) };
}

export function openSecretPayload(sealed: SealedSecret, env?: NodeJS.ProcessEnv): Record<string, string> {
  const { current, previous } = readMasterKeys(env);
  let key: string | null = null;
  if (sealed.kekId === kekIdOf(current)) key = current;
  else if (previous && sealed.kekId === kekIdOf(previous)) key = previous;
  if (!key) throw new VaultDecryptError("cannot decrypt credential");
  try {
    const dek = decryptSecret(sealed.wrappedDek, key);
    const plain = decryptSecret(sealed.ciphertext, dek);
    const parsed: unknown = JSON.parse(plain);
    if (!isStringRecord(parsed)) throw new VaultDecryptError("cannot decrypt credential");
    return parsed;
  } catch (error) {
    if (error instanceof VaultDecryptError) throw error;
    throw new VaultDecryptError("cannot decrypt credential");
  }
}
