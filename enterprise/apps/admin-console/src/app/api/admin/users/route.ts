import {
  createAdminUser,
  listAdminUsers,
  type AdminUserStatus,
  type ListUsersFilter,
} from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { getDefaultOrgId } from "../../../../lib/admin-pg-auth";

function isStatus(value: unknown): value is AdminUserStatus {
  return value === "active" || value === "disabled" || value === "locked";
}

export async function GET(request: Request) {
  const auth = await requireAdminScope(["user:read"]);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const filter: ListUsersFilter = {};
  const q = searchParams.get("q")?.trim();
  if (q) filter.q = q;
  const status = searchParams.get("status");
  if (isStatus(status)) filter.status = status;
  const deptId = searchParams.get("deptId");
  if (deptId) filter.deptId = deptId;
  const roleCode = searchParams.get("roleCode");
  if (roleCode) filter.roleCode = roleCode;
  const limit = Number(searchParams.get("limit") ?? "");
  if (Number.isFinite(limit) && limit > 0) filter.limit = limit;
  const offset = Number(searchParams.get("offset") ?? "");
  if (Number.isFinite(offset) && offset >= 0) filter.offset = offset;

  const result = await listAdminUsers(auth.session.tenantId, filter);
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: result,
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["user:create"]);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email : "";
    const displayName = typeof body.displayName === "string" ? body.displayName : "";
    const deptId = typeof body.deptId === "string" ? body.deptId : body.deptId === null ? null : null;
    const rawStatus = body.status;
    const status = isStatus(rawStatus) ? rawStatus : undefined;
    const password =
      typeof body.initialPassword === "string"
        ? body.initialPassword
        : typeof body.password === "string"
          ? body.password
          : undefined;
    const phone = typeof body.phone === "string" ? body.phone : null;
    const employeeNo = typeof body.employeeNo === "string" ? body.employeeNo : null;
    const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle : null;
    const roleCodes = Array.isArray(body.roleCodes)
      ? body.roleCodes.filter((x): x is string => typeof x === "string")
      : undefined;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ code: "40000", message: "invalid email" }, { status: 400 });
    }
    if (!displayName.trim()) {
      return NextResponse.json({ code: "40000", message: "displayName is required" }, { status: 400 });
    }
    if (password !== undefined && password.length > 0 && password.length < 8) {
      return NextResponse.json(
        { code: "40000", message: "password must be at least 8 chars" },
        { status: 400 }
      );
    }

    const defaultOrgId = await getDefaultOrgId(auth.session.tenantId);
    const created = await createAdminUser({
      tenantId: auth.session.tenantId,
      email,
      displayName,
      deptId,
      status,
      phone,
      employeeNo,
      jobTitle,
      roleCodes,
      initialPassword: password ?? null,
      defaultOrgId,
      actorUserId: auth.session.userId,
    });

    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        user: created.user,
        initialPassword: created.initialPassword,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        code: "40000",
        message: error instanceof Error ? error.message : "invalid request",
      },
      { status: 400 }
    );
  }
}
