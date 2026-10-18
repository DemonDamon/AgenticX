/**
 * Case library lifecycle. Unpublished cases stay visible only to the submitter
 * and case admins. Publishing is a separate step after archive.
 *
 * Author: Damon Li
 */

import os from "node:os";
import path from "node:path";

export const CASE_STATUSES = ["submitted", "reviewing", "archived", "published"] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

const NEXT: Record<CaseStatus, readonly CaseStatus[]> = {
  submitted: ["reviewing"],
  reviewing: ["submitted", "archived"],
  archived: ["published"],
  published: [],
};

export function isCaseStatus(value: string): value is CaseStatus {
  return (CASE_STATUSES as readonly string[]).includes(value);
}

export function canTransitionCase(from: CaseStatus, to: CaseStatus): boolean {
  return NEXT[from].includes(to);
}

export function caseLibraryDir(): string {
  const fromEnv = process.env.ENTERPRISE_CASE_LIBRARY_DIR?.trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".agenticx", "enterprise-cases");
}

export function casePackageFile(tenantId: string, caseId: string): string {
  if (!/^[\w-]+$/.test(tenantId) || !/^[\w-]+$/.test(caseId)) {
    throw new Error("invalid case path");
  }
  return path.join(caseLibraryDir(), tenantId, `${caseId}.zip`);
}

export const VIEW_PACKAGE_FORMAT = "agx-view-package/1";

export function isViewPackageManifest(value: unknown): value is { format: string; pages: unknown[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.format === VIEW_PACKAGE_FORMAT && Array.isArray(record.pages) && record.pages.length > 0;
}
