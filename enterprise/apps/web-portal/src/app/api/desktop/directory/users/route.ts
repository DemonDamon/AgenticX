import { listAdminUsers, listDepartmentsFlat, type ListUsersFilter } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { resolveDesktopIdentity } from "../../../../../lib/desktop-auth";
import {
  desktopRoomErrorResponse,
  desktopRoomUnauthorized,
} from "../../../../../lib/desktop-collab-room-http";

const DEFAULT_LIMIT = 20;

export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) return desktopRoomUnauthorized();

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limitRaw = url.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitRaw != null && limitRaw !== "") {
    const parsed = Number(limitRaw);
    if (Number.isInteger(parsed) && parsed > 0) limit = parsed;
  }
  limit = Math.min(limit, DEFAULT_LIMIT);

  const filter: ListUsersFilter = { limit };
  if (q) {
    filter.q = q;
  } else if (identity.deptId) {
    filter.deptId = identity.deptId;
    filter.deptScope = "direct";
  }

  try {
    const listed = await listAdminUsers(identity.tenantId, filter);
    const departments = await listDepartmentsFlat(identity.tenantId);
    const deptNames = new Map(departments.map((dept) => [dept.id, dept.name]));
    const users = listed.items
      .filter((user) => user.status !== "disabled")
      .map((user) => ({
        id: user.id,
        display_name: user.displayName,
        email: user.email,
        dept_name: user.deptId ? (deptNames.get(user.deptId) ?? "") : "",
      }));
    return NextResponse.json({ code: "00000", message: "ok", data: { users } });
  } catch (error) {
    return desktopRoomErrorResponse(error);
  }
}
