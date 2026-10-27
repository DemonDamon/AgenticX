export type MaCredentialType = "static_bearer" | "mcp_oauth" | "bearer" | "environment_variable";
export const MA_CREDENTIAL_TYPES: readonly MaCredentialType[] = [
  "static_bearer",
  "mcp_oauth",
  "bearer",
  "environment_variable",
];
export type MaIdentityKind = "mcp_server_url" | "host" | "secret_name";
export type MaNetworking = { type: "unrestricted" } | { type: "limited"; allowed_hosts: string[] };
export type MaTokenEndpointAuthType = "none" | "client_secret_basic" | "client_secret_post";
export type MaRefreshPublic = {
  token_endpoint: string;
  client_id: string;
  scope: string | null;
  resource: string | null;
  token_endpoint_auth_type: MaTokenEndpointAuthType;
};
export type NormalizedCredentialCreate = {
  type: MaCredentialType;
  displayName: string | null;
  identityKind: MaIdentityKind;
  identityKey: string;
  publicConfig: Record<string, unknown>;
  secrets: Record<string, string>;
  expiresAt: string | null;
};
export type NormalizedCredentialPatch = {
  displayName?: string | null;
  secrets: Record<string, string>;
  clearSecrets: string[];
  publicConfigPatch: Record<string, unknown | null>;
  expiresAt?: string | null;
};
export type VaultInput = {
  displayName?: string;
  description?: string | null;
  metadata?: Record<string, string>;
};

export class MaVaultValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaVaultValidationError";
  }
}

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SECRET_FORBIDDEN_RE = /[\r\n\u0000]/;
const CRED_REF = "${cred:";
const METADATA_KEY_RE = /^[A-Za-z0-9_.-]+$/;
const SECRET_NAME_RE = /^[A-Z_][A-Z0-9_]{0,127}$/;
const HOST_RE = /^(\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const RESERVED_SECRET_NAMES = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "LOGNAME",
  "PWD",
  "TMPDIR",
  "LANG",
  "TERM",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "PYTHONPATH",
  "PYTHONHOME",
]);
const RESERVED_PREFIXES = ["LD_", "DYLD_", "AGX_", "MA_"];
const AUTH_TYPES: readonly MaTokenEndpointAuthType[] = ["none", "client_secret_basic", "client_secret_post"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(record: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  const unknown = Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .sort();
  if (unknown[0]) throw new MaVaultValidationError(`${prefix}${unknown[0]}: unknown field`);
}

function assertPrintableAscii(value: string, field: string): void {
  if (value.length > 512) {
    throw new MaVaultValidationError(`${field}: must be an https URL without query, fragment or credentials`);
  }
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) {
      throw new MaVaultValidationError(`${field}: must be an https URL without query, fragment or credentials`);
    }
  }
}

function normalizeMcpUrl(raw: string, allowQuery: boolean): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) {
    throw new MaVaultValidationError(
      "auth.mcp_server_url: must be an https URL without query, fragment or credentials",
    );
  }
  assertPrintableAscii(trimmed, "auth.mcp_server_url");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new MaVaultValidationError(
      "auth.mcp_server_url: must be an https URL without query, fragment or credentials",
    );
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || (!allowQuery && parsed.search)) {
    throw new MaVaultValidationError(
      "auth.mcp_server_url: must be an https URL without query, fragment or credentials",
    );
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const netloc = parsed.port && parsed.port !== "443" ? `${host}:${parsed.port}` : host;
  const path = parsed.pathname.replace(/\/+$/, "");
  return `https://${netloc}${path}${allowQuery ? parsed.search : ""}`;
}

export function normalizeMcpServerUrl(raw: string): string {
  return normalizeMcpUrl(raw, false);
}

/** Manifest 匹配：同一套归一化，但保留 query。带 query 的地址不会命中凭证 URL。 */
export function normalizeMcpServerUrlKeepingQuery(raw: string): string | null {
  if (typeof raw !== "string") return null;
  try {
    return normalizeMcpUrl(raw, true);
  } catch {
    return null;
  }
}

export function normalizeHost(raw: string, opts: { allowWildcard: boolean }): string {
  if (typeof raw !== "string") throw new MaVaultValidationError("auth.host: invalid host");
  const value = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!value || value.length > 253) throw new MaVaultValidationError("auth.host: invalid host");
  if (!opts.allowWildcard && value.startsWith("*.")) {
    throw new MaVaultValidationError("auth.host: invalid host");
  }
  if (IPV4_RE.test(value)) return value;
  if (!HOST_RE.test(value)) throw new MaVaultValidationError("auth.host: invalid host");
  return value;
}

export function validateSecretName(raw: string): string {
  if (typeof raw !== "string" || !SECRET_NAME_RE.test(raw.trim())) {
    throw new MaVaultValidationError("auth.secret_name: invalid name");
  }
  const name = raw.trim();
  if (RESERVED_SECRET_NAMES.has(name) || RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    throw new MaVaultValidationError("auth.secret_name: reserved name");
  }
  return name;
}

function assertSecretValue(value: unknown, field: string, rejectBearerPrefix: boolean): string {
  if (typeof value !== "string") throw new MaVaultValidationError(`${field}: must be a string`);
  if (rejectBearerPrefix && /^bearer /i.test(value)) {
    throw new MaVaultValidationError(`${field}: must not include the "Bearer " prefix`);
  }
  if (value.length < 8) throw new MaVaultValidationError(`${field}: must be at least 8 characters`);
  if (value.length > 16384) throw new MaVaultValidationError(`${field}: must be at most 16384 characters`);
  if (SECRET_FORBIDDEN_RE.test(value)) {
    throw new MaVaultValidationError(`${field}: must not contain control characters`);
  }
  if (value.includes(CRED_REF)) {
    throw new MaVaultValidationError(`${field}: must not contain a credential reference`);
  }
  return value;
}

function assertSecretBudget(secrets: Record<string, string>): void {
  let total = 0;
  for (const value of Object.values(secrets)) total += Buffer.byteLength(value, "utf8");
  if (total > 32768) throw new MaVaultValidationError("auth: secrets exceed 32768 bytes");
}

function parseIso(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) {
    throw new MaVaultValidationError(`${field}: must be an ISO-8601 timestamp`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function assertHttpsEndpoint(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new MaVaultValidationError(`${field}: must be an https URL`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new MaVaultValidationError(`${field}: must be an https URL`);
  for (const ch of trimmed) {
    const code = ch.charCodeAt(0);
    if (code < 0x21 || code > 0x7e) throw new MaVaultValidationError(`${field}: must be an https URL`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new MaVaultValidationError(`${field}: must be an https URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new MaVaultValidationError(`${field}: must be an https URL`);
  }
  return trimmed;
}

function optionalBoundedString(value: unknown, field: string, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > max) {
    throw new MaVaultValidationError(`${field}: must be a string of at most ${max} characters`);
  }
  return value;
}

function readDisplayName(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new MaVaultValidationError("display_name: must be a string or null");
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 255) {
    throw new MaVaultValidationError("display_name: must be 1–255 characters or null");
  }
  if (CONTROL_RE.test(trimmed)) throw new MaVaultValidationError("display_name: contains control characters");
  return trimmed;
}

export function readNetworking(value: unknown): MaNetworking | null {
  if (!isRecord(value) || (value.type !== "unrestricted" && value.type !== "limited")) return null;
  if (value.type === "unrestricted") return { type: "unrestricted" };
  if (!Array.isArray(value.allowed_hosts) || !value.allowed_hosts.every((item) => typeof item === "string")) return null;
  return { type: "limited", allowed_hosts: value.allowed_hosts };
}

export function readRefreshPublic(value: unknown): MaRefreshPublic | null {
  if (!isRecord(value)) return null;
  const authType = value.token_endpoint_auth_type;
  if (typeof value.token_endpoint !== "string" || typeof value.client_id !== "string") return null;
  if (authType !== "none" && authType !== "client_secret_basic" && authType !== "client_secret_post") return null;
  return {
    token_endpoint: value.token_endpoint,
    client_id: value.client_id,
    scope: typeof value.scope === "string" ? value.scope : null,
    resource: typeof value.resource === "string" ? value.resource : null,
    token_endpoint_auth_type: authType,
  };
}

function parseNetworking(value: unknown): MaNetworking {
  if (value === undefined) throw new MaVaultValidationError("auth.networking: is required");
  if (!isRecord(value)) throw new MaVaultValidationError("auth.networking: must be an object");
  rejectUnknown(value, ["type", "allowed_hosts"], "auth.networking.");
  if (value.type === "unrestricted") {
    if ("allowed_hosts" in value) {
      throw new MaVaultValidationError("auth.networking: allowed_hosts is not allowed when type is unrestricted");
    }
    return { type: "unrestricted" };
  }
  if (value.type !== "limited") {
    throw new MaVaultValidationError("auth.networking: type must be unrestricted or limited");
  }
  if (!Array.isArray(value.allowed_hosts)) {
    throw new MaVaultValidationError("auth.networking.allowed_hosts: must be an array");
  }
  if (value.allowed_hosts.length < 1 || value.allowed_hosts.length > 16) {
    throw new MaVaultValidationError("auth.networking.allowed_hosts: must contain 1 to 16 hosts");
  }
  const hosts: string[] = [];
  for (const item of value.allowed_hosts) {
    let host: string;
    try {
      host = normalizeHost(String(item), { allowWildcard: true });
    } catch {
      throw new MaVaultValidationError("auth.networking.allowed_hosts: invalid host");
    }
    if (!hosts.includes(host)) hosts.push(host);
  }
  if (hosts.length < 1) throw new MaVaultValidationError("auth.networking.allowed_hosts: must contain 1 to 16 hosts");
  return { type: "limited", allowed_hosts: hosts };
}

function parseTokenEndpointAuth(value: unknown): { type: MaTokenEndpointAuthType; clientSecret: string | null } {
  if (!isRecord(value)) throw new MaVaultValidationError("auth.refresh.token_endpoint_auth: must be an object");
  rejectUnknown(value, ["type", "client_secret"], "auth.refresh.token_endpoint_auth.");
  if (!AUTH_TYPES.includes(value.type as MaTokenEndpointAuthType)) {
    throw new MaVaultValidationError("auth.refresh.token_endpoint_auth.type: is invalid");
  }
  const type = value.type as MaTokenEndpointAuthType;
  if (type === "none") {
    if ("client_secret" in value) {
      throw new MaVaultValidationError(
        "auth.refresh.token_endpoint_auth.client_secret: must be omitted when type is none",
      );
    }
    return { type, clientSecret: null };
  }
  return {
    type,
    clientSecret: assertSecretValue(value.client_secret, "auth.refresh.token_endpoint_auth.client_secret", false),
  };
}

function parseRefresh(value: unknown): { refresh: MaRefreshPublic; secrets: Record<string, string> } {
  if (!isRecord(value)) throw new MaVaultValidationError("auth.refresh: must be an object");
  rejectUnknown(
    value,
    ["token_endpoint", "client_id", "scope", "resource", "refresh_token", "token_endpoint_auth"],
    "auth.refresh.",
  );
  const tokenEndpoint = assertHttpsEndpoint(value.token_endpoint, "auth.refresh.token_endpoint", 512);
  if (typeof value.client_id !== "string" || !value.client_id.trim() || value.client_id.trim().length > 255) {
    throw new MaVaultValidationError("auth.refresh.client_id: must be 1–255 characters");
  }
  const scope = "scope" in value ? optionalBoundedString(value.scope, "auth.refresh.scope", 1024) : null;
  let resource: string | null = null;
  if ("resource" in value && value.resource != null && value.resource !== "") {
    resource = assertHttpsEndpoint(value.resource, "auth.refresh.resource", 512);
  }
  const refreshToken = assertSecretValue(value.refresh_token, "auth.refresh.refresh_token", false);
  const auth = parseTokenEndpointAuth(value.token_endpoint_auth);
  const secrets: Record<string, string> = { refresh_token: refreshToken };
  if (auth.clientSecret) secrets.client_secret = auth.clientSecret;
  return {
    refresh: {
      token_endpoint: tokenEndpoint,
      client_id: value.client_id.trim(),
      scope,
      resource,
      token_endpoint_auth_type: auth.type,
    },
    secrets,
  };
}

function isCredentialType(value: unknown): value is MaCredentialType {
  return MA_CREDENTIAL_TYPES.includes(value as MaCredentialType);
}

export function validateVaultInput(
  body: { display_name?: unknown; description?: unknown; metadata?: unknown },
  mode: "create" | "update",
): VaultInput {
  const record = body as Record<string, unknown>;
  const input: VaultInput = {};
  let seen = false;
  if ("display_name" in record) {
    seen = true;
    if (typeof record.display_name !== "string") throw new MaVaultValidationError("display_name: must be a string");
    const trimmed = record.display_name.trim();
    if (!trimmed || trimmed.length > 255) throw new MaVaultValidationError("display_name: must be 1–255 characters");
    if (CONTROL_RE.test(trimmed)) throw new MaVaultValidationError("display_name: contains control characters");
    input.displayName = trimmed;
  } else if (mode === "create") {
    throw new MaVaultValidationError("display_name: is required");
  }
  if ("description" in record) {
    seen = true;
    if (record.description !== null && typeof record.description !== "string") {
      throw new MaVaultValidationError("description: must be a string or null");
    }
    if (typeof record.description === "string" && record.description.length > 1024) {
      throw new MaVaultValidationError("description: must be at most 1024 characters");
    }
    input.description = typeof record.description === "string" ? record.description : null;
  }
  if ("metadata" in record) {
    seen = true;
    if (!isRecord(record.metadata)) throw new MaVaultValidationError("metadata: must be an object");
    const keys = Object.keys(record.metadata);
    if (keys.length > 16) throw new MaVaultValidationError("metadata: at most 16 keys");
    const metadata: Record<string, string> = {};
    for (const key of keys) {
      if (!METADATA_KEY_RE.test(key) || key.length > 64) throw new MaVaultValidationError("metadata: invalid key");
      const item = record.metadata[key];
      if (typeof item !== "string" || item.length > 512) {
        throw new MaVaultValidationError(`metadata.${key}: value must be a string of at most 512 characters`);
      }
      metadata[key] = item;
    }
    input.metadata = metadata;
  }
  if (mode === "update" && !seen) throw new MaVaultValidationError("request: nothing to update");
  return input;
}

export function normalizeCredentialCreate(body: Record<string, unknown>): NormalizedCredentialCreate {
  rejectUnknown(body, ["display_name", "auth"], "");
  const displayName = "display_name" in body ? readDisplayName(body.display_name) : null;
  if (!isRecord(body.auth)) throw new MaVaultValidationError("auth: must be an object");
  const auth = body.auth;
  if (!isCredentialType(auth.type)) throw new MaVaultValidationError("auth.type: unknown credential type");
  const secrets: Record<string, string> = {};
  let identityKind: MaIdentityKind;
  let identityKey: string;
  let publicConfig: Record<string, unknown> = {};
  let expiresAt: string | null = null;

  switch (auth.type) {
    case "static_bearer": {
      rejectUnknown(auth, ["type", "mcp_server_url", "token"], "auth.");
      if (typeof auth.mcp_server_url !== "string") {
        throw new MaVaultValidationError("auth.mcp_server_url: is required");
      }
      identityKind = "mcp_server_url";
      identityKey = normalizeMcpServerUrl(auth.mcp_server_url);
      secrets.token = assertSecretValue(auth.token, "auth.token", true);
      break;
    }
    case "bearer": {
      rejectUnknown(auth, ["type", "host", "token"], "auth.");
      if (typeof auth.host !== "string") throw new MaVaultValidationError("auth.host: is required");
      identityKind = "host";
      identityKey = normalizeHost(auth.host, { allowWildcard: false });
      secrets.token = assertSecretValue(auth.token, "auth.token", true);
      break;
    }
    case "mcp_oauth": {
      rejectUnknown(auth, ["type", "mcp_server_url", "access_token", "expires_at", "refresh"], "auth.");
      if (typeof auth.mcp_server_url !== "string") {
        throw new MaVaultValidationError("auth.mcp_server_url: is required");
      }
      identityKind = "mcp_server_url";
      identityKey = normalizeMcpServerUrl(auth.mcp_server_url);
      secrets.access_token = assertSecretValue(auth.access_token, "auth.access_token", false);
      if ("expires_at" in auth && auth.expires_at != null) {
        expiresAt = parseIso(auth.expires_at, "auth.expires_at");
      }
      if ("refresh" in auth && auth.refresh != null) {
        if (!expiresAt) throw new MaVaultValidationError("auth.expires_at: required when refresh is configured");
        const parsed = parseRefresh(auth.refresh);
        publicConfig = { refresh: parsed.refresh };
        Object.assign(secrets, parsed.secrets);
      }
      break;
    }
    case "environment_variable": {
      rejectUnknown(auth, ["type", "secret_name", "secret_value", "networking"], "auth.");
      if (typeof auth.secret_name !== "string") throw new MaVaultValidationError("auth.secret_name: is required");
      identityKind = "secret_name";
      identityKey = validateSecretName(auth.secret_name);
      secrets.secret_value = assertSecretValue(auth.secret_value, "auth.secret_value", false);
      publicConfig = { networking: parseNetworking(auth.networking) };
      break;
    }
    default: {
      const unreachable: never = auth.type;
      throw new MaVaultValidationError(`auth.type: unknown credential type ${String(unreachable)}`);
    }
  }
  assertSecretBudget(secrets);
  return { type: auth.type, displayName, identityKind, identityKey, publicConfig, secrets, expiresAt };
}

function applyRefreshPatch(
  existing: MaRefreshPublic | null,
  refresh: unknown,
  patch: NormalizedCredentialPatch,
): boolean {
  if (refresh === null) {
    patch.publicConfigPatch.refresh = null;
    for (const key of ["refresh_token", "client_secret"]) {
      if (!patch.clearSecrets.includes(key)) patch.clearSecrets.push(key);
    }
    return true;
  }
  if (!existing) {
    const parsed = parseRefresh(refresh);
    patch.publicConfigPatch.refresh = parsed.refresh;
    Object.assign(patch.secrets, parsed.secrets);
    return true;
  }
  if (!isRecord(refresh)) throw new MaVaultValidationError("auth.refresh: must be an object");
  rejectUnknown(
    refresh,
    ["token_endpoint", "client_id", "scope", "resource", "refresh_token", "token_endpoint_auth"],
    "auth.refresh.",
  );
  const next: MaRefreshPublic = { ...existing };
  let changed = false;
  if ("token_endpoint" in refresh && refresh.token_endpoint !== existing.token_endpoint) {
    throw new MaVaultValidationError("auth.refresh.token_endpoint: is immutable");
  }
  if ("client_id" in refresh && refresh.client_id !== existing.client_id) {
    throw new MaVaultValidationError("auth.refresh.client_id: is immutable");
  }
  if ("scope" in refresh) {
    next.scope = optionalBoundedString(refresh.scope, "auth.refresh.scope", 1024);
    changed = true;
  }
  if ("resource" in refresh) {
    next.resource =
      refresh.resource == null || refresh.resource === ""
        ? null
        : assertHttpsEndpoint(refresh.resource, "auth.refresh.resource", 512);
    changed = true;
  }
  if ("refresh_token" in refresh) {
    patch.secrets.refresh_token = assertSecretValue(refresh.refresh_token, "auth.refresh.refresh_token", false);
    changed = true;
  }
  if ("token_endpoint_auth" in refresh) {
    if (!isRecord(refresh.token_endpoint_auth)) {
      throw new MaVaultValidationError("auth.refresh.token_endpoint_auth: must be an object");
    }
    rejectUnknown(refresh.token_endpoint_auth, ["type", "client_secret"], "auth.refresh.token_endpoint_auth.");
    const nextType = refresh.token_endpoint_auth.type;
    if (nextType !== "none" && nextType !== "client_secret_basic" && nextType !== "client_secret_post") {
      throw new MaVaultValidationError("auth.refresh.token_endpoint_auth.type: is invalid");
    }
    const typeChanged = nextType !== existing.token_endpoint_auth_type;
    if (nextType === "none") {
      if ("client_secret" in refresh.token_endpoint_auth) {
        throw new MaVaultValidationError(
          "auth.refresh.token_endpoint_auth.client_secret: must be omitted when type is none",
        );
      }
      if (!patch.clearSecrets.includes("client_secret")) patch.clearSecrets.push("client_secret");
    } else if ("client_secret" in refresh.token_endpoint_auth) {
      patch.secrets.client_secret = assertSecretValue(
        refresh.token_endpoint_auth.client_secret,
        "auth.refresh.token_endpoint_auth.client_secret",
        false,
      );
    } else if (typeChanged) {
      throw new MaVaultValidationError("auth.refresh.token_endpoint_auth.client_secret: is required");
    }
    next.token_endpoint_auth_type = nextType;
    changed = true;
  }
  if (changed) patch.publicConfigPatch.refresh = next;
  return changed;
}

export function normalizeCredentialPatch(
  existing: { type: MaCredentialType; publicConfig: Record<string, unknown> },
  body: Record<string, unknown>,
): NormalizedCredentialPatch {
  rejectUnknown(body, ["display_name", "auth"], "");
  const patch: NormalizedCredentialPatch = { secrets: {}, clearSecrets: [], publicConfigPatch: {} };
  let changed = false;
  if ("display_name" in body) {
    patch.displayName = readDisplayName(body.display_name);
    changed = true;
  }
  if ("auth" in body) {
    if (!isRecord(body.auth)) throw new MaVaultValidationError("auth: must be an object");
    const auth = body.auth;
    if (!("type" in auth)) throw new MaVaultValidationError("auth.type: is required");
    if (auth.type !== existing.type) throw new MaVaultValidationError("auth.type: must equal the credential type");
    const identityKey =
      existing.type === "environment_variable" ? "secret_name" : existing.type === "bearer" ? "host" : "mcp_server_url";
    if (identityKey in auth) {
      throw new MaVaultValidationError(`auth.${identityKey}: is immutable; create a new credential instead`);
    }
    switch (existing.type) {
      case "static_bearer":
      case "bearer": {
        rejectUnknown(auth, ["type", "token", identityKey], "auth.");
        if ("token" in auth) {
          patch.secrets.token = assertSecretValue(auth.token, "auth.token", true);
          changed = true;
        }
        break;
      }
      case "environment_variable": {
        rejectUnknown(auth, ["type", "secret_value", "networking", "secret_name"], "auth.");
        if ("secret_value" in auth) {
          patch.secrets.secret_value = assertSecretValue(auth.secret_value, "auth.secret_value", false);
          changed = true;
        }
        if ("networking" in auth) {
          patch.publicConfigPatch.networking = parseNetworking(auth.networking);
          changed = true;
        }
        break;
      }
      case "mcp_oauth": {
        rejectUnknown(auth, ["type", "access_token", "expires_at", "refresh", "mcp_server_url"], "auth.");
        if ("access_token" in auth) {
          patch.secrets.access_token = assertSecretValue(auth.access_token, "auth.access_token", false);
          changed = true;
        }
        if ("expires_at" in auth) {
          patch.expiresAt = auth.expires_at === null ? null : parseIso(auth.expires_at, "auth.expires_at");
          changed = true;
        }
        if ("refresh" in auth) {
          const existingRefresh = readRefreshPublic(existing.publicConfig.refresh);
          if (auth.refresh !== null && !existingRefresh && patch.expiresAt === undefined && !("expires_at" in auth)) {
            throw new MaVaultValidationError("auth.expires_at: required when refresh is configured");
          }
          if (auth.refresh !== null && !existingRefresh && patch.expiresAt === null) {
            throw new MaVaultValidationError("auth.expires_at: required when refresh is configured");
          }
          if (applyRefreshPatch(existingRefresh, auth.refresh, patch)) changed = true;
        }
        break;
      }
      default: {
        const unreachable: never = existing.type;
        throw new MaVaultValidationError(String(unreachable));
      }
    }
  }
  if (!changed && Object.keys(patch.secrets).length === 0 && patch.clearSecrets.length === 0) {
    throw new MaVaultValidationError("request: nothing to update");
  }
  assertSecretBudget(patch.secrets);
  return patch;
}

export function assertCredentialSecrets(
  type: MaCredentialType,
  publicConfig: Record<string, unknown>,
  secrets: Record<string, string>,
): void {
  const requireKey = (key: string) => {
    if (typeof secrets[key] !== "string" || secrets[key].length < 8) {
      throw new MaVaultValidationError(`auth.${key}: is required`);
    }
  };
  switch (type) {
    case "static_bearer":
    case "bearer":
      requireKey("token");
      break;
    case "environment_variable":
      requireKey("secret_value");
      break;
    case "mcp_oauth": {
      requireKey("access_token");
      const refresh = readRefreshPublic(publicConfig.refresh);
      if (refresh) {
        requireKey("refresh_token");
        if (refresh.token_endpoint_auth_type === "client_secret_basic" || refresh.token_endpoint_auth_type === "client_secret_post") {
          requireKey("client_secret");
        }
      }
      break;
    }
    default: {
      const unreachable: never = type;
      throw new MaVaultValidationError(String(unreachable));
    }
  }
  assertSecretBudget(secrets);
}
