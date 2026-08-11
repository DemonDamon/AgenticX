import { adminFetch } from "./admin-client-auth";

export type AdminDirectoryUser = {
  id: string;
  email: string;
  displayName: string;
};

export type AdminUserDirectory = {
  byId: Map<string, string>;
  byEmail: Map<string, string>;
};

type UserListResponse = {
  data?: {
    items: AdminDirectoryUser[];
    total: number;
  };
};

export function emptyAdminUserDirectory(): AdminUserDirectory {
  return { byId: new Map(), byEmail: new Map() };
}

/** Load the same tenant user directory used to render audit actors by name. */
export async function loadAdminUserDirectory(pageSize = 200): Promise<AdminUserDirectory> {
  try {
    const firstResponse = await adminFetch(`/api/admin/users?limit=${pageSize}&offset=0`);
    if (!firstResponse.ok) return emptyAdminUserDirectory();
    const firstPayload = (await firstResponse.json()) as UserListResponse;
    const firstPage = firstPayload.data;
    if (!firstPage) return emptyAdminUserDirectory();

    const users = [...firstPage.items];
    for (let offset = pageSize; offset < firstPage.total; offset += pageSize) {
      const response = await adminFetch(`/api/admin/users?limit=${pageSize}&offset=${offset}`);
      if (!response.ok) break;
      const payload = (await response.json()) as UserListResponse;
      if (!payload.data?.items.length) break;
      users.push(...payload.data.items);
    }

    const byId = new Map<string, string>();
    const byEmail = new Map<string, string>();
    for (const user of users) {
      const displayName = user.displayName.trim();
      if (!displayName) continue;
      byId.set(user.id, displayName);
      if (user.email) byEmail.set(user.email.toLowerCase(), displayName);
    }
    return { byId, byEmail };
  } catch {
    // The dashboard and audit list remain usable with email/ID fallbacks.
    return emptyAdminUserDirectory();
  }
}

export function resolveAdminUserLabel(
  directory: AdminUserDirectory,
  userId?: string | null,
  userEmail?: string | null,
): string {
  return (
    (userId ? directory.byId.get(userId) : undefined) ??
    (userEmail ? directory.byEmail.get(userEmail.toLowerCase()) : undefined) ??
    userEmail ??
    userId ??
    "—"
  );
}
