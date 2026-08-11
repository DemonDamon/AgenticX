import { adminFetch } from "./admin-client-auth";

export type AdminDirectoryDepartment = {
  id: string;
  name: string;
  path?: string | null;
};

export type AdminDepartmentDirectory = {
  byId: Map<string, string>;
};

type DepartmentListResponse = {
  data?: {
    items?: AdminDirectoryDepartment[];
  };
};

export function emptyAdminDepartmentDirectory(): AdminDepartmentDirectory {
  return { byId: new Map() };
}

function departmentLabel(department: AdminDirectoryDepartment): string {
  const path = department.path
    ?.trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .join(" / ");
  return path || department.name.trim() || department.id;
}

/** Load department names for dashboard dimensions without coupling metering to IAM. */
export async function loadAdminDepartmentDirectory(): Promise<AdminDepartmentDirectory> {
  try {
    const response = await adminFetch("/api/admin/departments?shape=flat");
    if (!response.ok) return emptyAdminDepartmentDirectory();
    const payload = (await response.json()) as DepartmentListResponse;
    const byId = new Map<string, string>();
    for (const department of payload.data?.items ?? []) {
      if (!department?.id) continue;
      byId.set(department.id, departmentLabel(department));
    }
    return { byId };
  } catch {
    // Keep the chart usable with raw IDs if IAM is temporarily unavailable.
    return emptyAdminDepartmentDirectory();
  }
}

export function resolveAdminDepartmentLabel(
  directory: AdminDepartmentDirectory,
  departmentId?: string | null,
  emptyLabel = "—",
): string {
  const normalized = departmentId?.trim();
  if (!normalized) return emptyLabel;
  return directory.byId.get(normalized) ?? normalized;
}
