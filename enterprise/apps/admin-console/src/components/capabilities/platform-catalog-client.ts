import type { adminFetch } from "../../lib/admin-client-auth";

export type PlatformCatalogFetch = typeof adminFetch;

export type CatalogItemRow = {
  id: string;
  slug: string;
  displayName: string;
  resourceType: string;
  shelfStatus: string;
  version: string;
  effectiveVersionId?: string | null;
};

export type CatalogVersionRow = {
  id: string;
  catalogItemId: string;
  version: string;
  shelfStatus: string;
  scanVerdict?: string | null;
};

export type CatalogGrantRow = {
  id: string;
  tenantId: string;
  status: string;
  revokePolicy?: string | null;
};

type ApiEnvelope<T> = { code?: string; message?: string; data?: T };

function apiError(json: ApiEnvelope<unknown>, fallback: string): string {
  return typeof json.message === "string" && json.message.trim() ? json.message : fallback;
}

export async function listPlatformCatalogItems(
  fetch: PlatformCatalogFetch,
  fallbackError: string,
): Promise<CatalogItemRow[]> {
  const res = await fetch("/api/admin/platform-catalog", { cache: "no-store" });
  const json = (await res.json()) as ApiEnvelope<{ items?: CatalogItemRow[] }>;
  if (!res.ok) throw new Error(apiError(json, fallbackError));
  return json.data?.items ?? [];
}

export async function createPlatformCatalogItem(
  fetch: PlatformCatalogFetch,
  body: {
    slug: string;
    displayName?: string;
    resourceType?: string;
    version?: string;
    bundleUri?: string;
    bundleDigest?: string;
    packManifest?: Record<string, unknown>;
  },
  fallbackError: string,
): Promise<CatalogItemRow> {
  const res = await fetch("/api/admin/platform-catalog", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiEnvelope<{ item?: CatalogItemRow }>;
  if (!res.ok) throw new Error(apiError(json, fallbackError));
  if (!json.data?.item) throw new Error(fallbackError);
  return json.data.item;
}

export async function loadPlatformCatalogDetail(
  fetch: PlatformCatalogFetch,
  catalogId: string,
  fallbackError: string,
): Promise<{ item: CatalogItemRow; grants: CatalogGrantRow[] }> {
  const res = await fetch(`/api/admin/platform-catalog/${encodeURIComponent(catalogId)}`, {
    cache: "no-store",
  });
  const json = (await res.json()) as ApiEnvelope<{ item?: CatalogItemRow; grants?: CatalogGrantRow[] }>;
  if (!res.ok) throw new Error(apiError(json, fallbackError));
  if (!json.data?.item) throw new Error(fallbackError);
  return { item: json.data.item, grants: json.data.grants ?? [] };
}

export async function listPlatformCatalogVersions(
  fetch: PlatformCatalogFetch,
  catalogId: string,
  fallbackError: string,
): Promise<CatalogVersionRow[]> {
  const res = await fetch(`/api/admin/platform-catalog/${encodeURIComponent(catalogId)}/versions`, {
    cache: "no-store",
  });
  const json = (await res.json()) as ApiEnvelope<{ versions?: CatalogVersionRow[] }>;
  if (!res.ok) throw new Error(apiError(json, fallbackError));
  return json.data?.versions ?? [];
}

export async function createPlatformCatalogVersion(
  fetch: PlatformCatalogFetch,
  catalogId: string,
  body: { version: string; bundleUri?: string; bundleDigest?: string },
  fallbackError: string,
): Promise<CatalogVersionRow> {
  const res = await fetch(`/api/admin/platform-catalog/${encodeURIComponent(catalogId)}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiEnvelope<{ version?: CatalogVersionRow }>;
  if (!res.ok) throw new Error(apiError(json, fallbackError));
  if (!json.data?.version) throw new Error(fallbackError);
  return json.data.version;
}

export async function scanPlatformCatalogVersion(
  fetch: PlatformCatalogFetch,
  catalogId: string,
  versionId: string,
  fallbackError: string,
): Promise<CatalogVersionRow> {
  const res = await fetch(
    `/api/admin/platform-catalog/${encodeURIComponent(catalogId)}/versions/${encodeURIComponent(versionId)}/scan`,
    { method: "POST" },
  );
  const json = (await res.json()) as ApiEnvelope<{ version?: CatalogVersionRow }>;
  if (!res.ok) throw new Error(apiError(json, fallbackError));
  if (!json.data?.version) throw new Error(fallbackError);
  return json.data.version;
}

export async function publishPlatformCatalogVersion(
  fetch: PlatformCatalogFetch,
  catalogId: string,
  versionId: string,
  fallbackError: string,
): Promise<{ item: CatalogItemRow; version: CatalogVersionRow }> {
  const res = await fetch(
    `/api/admin/platform-catalog/${encodeURIComponent(catalogId)}/versions/${encodeURIComponent(versionId)}/publish`,
    { method: "POST" },
  );
  const json = (await res.json()) as ApiEnvelope<{ item?: CatalogItemRow; version?: CatalogVersionRow }>;
  if (!res.ok) throw new Error(apiError(json, fallbackError));
  if (!json.data?.item || !json.data.version) throw new Error(fallbackError);
  return { item: json.data.item, version: json.data.version };
}

export async function grantPlatformCatalogToTenant(
  fetch: PlatformCatalogFetch,
  catalogId: string,
  tenantId: string,
  fallbackError: string,
): Promise<void> {
  const res = await fetch(`/api/admin/platform-catalog/${encodeURIComponent(catalogId)}/grants`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tenantId.trim() }),
  });
  const json = (await res.json()) as ApiEnvelope<unknown>;
  if (!res.ok) throw new Error(apiError(json, fallbackError));
}

export async function revokePlatformCatalogFromTenant(
  fetch: PlatformCatalogFetch,
  catalogId: string,
  tenantId: string,
  policy: "retain_stop_updates" | "strip_bootstrap",
  fallbackError: string,
): Promise<void> {
  const res = await fetch(`/api/admin/platform-catalog/${encodeURIComponent(catalogId)}/grants`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tenantId.trim(), policy }),
  });
  const json = (await res.json()) as ApiEnvelope<unknown>;
  if (!res.ok) throw new Error(apiError(json, fallbackError));
}
