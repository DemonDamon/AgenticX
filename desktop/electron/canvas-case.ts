/**
 * Submit a canvas view package to the enterprise case library and fetch one back.
 *
 * Author: Damon Li
 */
import fs from "node:fs";
import path from "node:path";
import { proxyAwareFetch } from "./proxy-fetch";
import { readStoreZip } from "./zip-store";

const MAX_PACKAGE_BYTES = 12 * 1024 * 1024;

export type EnterpriseCaseCard = {
  id: string;
  title: string;
  summary: string;
  sourceRepo: string;
  status: string;
};

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function submitEnterpriseCase(input: {
  portalUrl: string;
  token: string;
  title: string;
  summary: string;
  sourceRepo: string;
  manifest: unknown;
  zip: Buffer;
}): Promise<{ ok: true; id: string; status: string } | { ok: false; error: string }> {
  if (input.zip.length === 0 || input.zip.length > MAX_PACKAGE_BYTES) {
    return { ok: false, error: "package is empty or too large" };
  }
  const resp = await proxyAwareFetch(`${input.portalUrl}/api/desktop/cases`, {
    method: "POST",
    headers: { ...authHeaders(input.token), "content-type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      summary: input.summary,
      sourceRepo: input.sourceRepo,
      manifest: input.manifest,
      packageBase64: input.zip.toString("base64"),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await resp.json().catch(() => ({}))) as {
    message?: string;
    data?: { id?: string; status?: string };
  };
  if (!resp.ok || !json.data?.id) {
    return { ok: false, error: json.message || `HTTP ${resp.status}` };
  }
  return { ok: true, id: json.data.id, status: json.data.status || "submitted" };
}

export async function listPublishedEnterpriseCases(input: {
  portalUrl: string;
  token: string;
}): Promise<{ ok: true; cases: EnterpriseCaseCard[] } | { ok: false; error: string }> {
  const resp = await proxyAwareFetch(`${input.portalUrl}/api/desktop/cases`, {
    headers: authHeaders(input.token),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await resp.json().catch(() => ({}))) as {
    message?: string;
    data?: { cases?: EnterpriseCaseCard[] };
  };
  if (!resp.ok) return { ok: false, error: json.message || `HTTP ${resp.status}` };
  return { ok: true, cases: Array.isArray(json.data?.cases) ? json.data.cases : [] };
}

export async function downloadEnterpriseCase(input: {
  portalUrl: string;
  token: string;
  id: string;
  destDir: string;
}): Promise<{ ok: true; rootDir: string } | { ok: false; error: string }> {
  const resp = await proxyAwareFetch(`${input.portalUrl}/api/desktop/cases/${encodeURIComponent(input.id)}/package`, {
    headers: authHeaders(input.token),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) {
    const json = (await resp.json().catch(() => ({}))) as { message?: string };
    return { ok: false, error: json.message || `HTTP ${resp.status}` };
  }
  const zip = Buffer.from(await resp.arrayBuffer());
  await fs.promises.mkdir(input.destDir, { recursive: true });
  extractStoreZip(zip, input.destDir);
  return { ok: true, rootDir: input.destDir };
}

export function extractStoreZip(zip: Buffer, destDir: string): void {
  for (const entry of readStoreZip(zip)) {
    const target = path.resolve(destDir, entry.name);
    const root = path.resolve(destDir);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error("unsafe zip path");
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
  }
}
