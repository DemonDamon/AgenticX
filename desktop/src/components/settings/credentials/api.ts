import { studioFetch } from "../../../utils/studio-fetch";

/** Name rule shared with the credential store: ^[A-Z][A-Z0-9_]{1,63}$ */
export const CREDENTIAL_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export type CredentialRecord = {
  name: string;
  description: string;
  updated_at: string;
  referenced_by: string[];
};

export type CredentialWriteBody = {
  value?: string;
  description?: string;
};

async function authHeaders(apiToken: string): Promise<HeadersInit> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
  if (token) headers["x-agx-desktop-token"] = token;
  return headers;
}

async function readError(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { detail?: unknown; error?: unknown };
    const detail = body.detail ?? body.error;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg: unknown }).msg);
          }
          return "";
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join("；");
    }
  } catch {
    // Response body was not JSON.
  }
  return resp.statusText || `HTTP ${resp.status}`;
}

function normalizeCredential(raw: unknown): CredentialRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = String(row.name ?? "").trim();
  if (!name) return null;
  const referencedBy = Array.isArray(row.referenced_by)
    ? row.referenced_by.map((item) => String(item))
    : [];
  return {
    name,
    description: String(row.description ?? ""),
    updated_at: String(row.updated_at ?? ""),
    referenced_by: referencedBy,
  };
}

/** Drop path-like or unknown labels. Only mcp/provider refs are shown. */
export function splitCredentialReference(ref: string): { kind: "mcp" | "provider"; name: string } | null {
  const splitAt = ref.indexOf(":");
  if (splitAt <= 0) return null;
  const kind = ref.slice(0, splitAt);
  const name = ref.slice(splitAt + 1).trim();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  if (kind !== "mcp" && kind !== "provider") return null;
  return { kind, name };
}

export async function listCredentials(apiToken: string): Promise<CredentialRecord[]> {
  const resp = await studioFetch("/api/credentials", {
    apiToken,
    headers: await authHeaders(apiToken),
  });
  if (!resp.ok) throw new Error(await readError(resp));
  const body = (await resp.json()) as { credentials?: unknown };
  if (!Array.isArray(body.credentials)) return [];
  return body.credentials
    .map(normalizeCredential)
    .filter((item): item is CredentialRecord => item !== null);
}

export async function upsertCredential(
  apiToken: string,
  name: string,
  body: CredentialWriteBody,
): Promise<void> {
  const resp = await studioFetch(`/api/credentials/${encodeURIComponent(name)}`, {
    method: "PUT",
    apiToken,
    headers: await authHeaders(apiToken),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await readError(resp));
}

export async function deleteCredential(apiToken: string, name: string): Promise<void> {
  const resp = await studioFetch(`/api/credentials/${encodeURIComponent(name)}`, {
    method: "DELETE",
    apiToken,
    headers: await authHeaders(apiToken),
  });
  if (!resp.ok) throw new Error(await readError(resp));
}
