import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../../lib/admin-auth";
import {
  createUser,
  listUsers,
  type AdminUserStatus,
  type ListUsersFilter,
} from "../../../../lib/users-store";

function isStatus(value: unknown): value is AdminUserStatus {
  return value === "active" || value === "disabled" || value === "locked";
}

export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const filter: ListUsersFilter = {};
  const q = searchParams.get("q")?.trim();
  if (q) filter.q = q;
  const status = searchParams.get("status");
  if (isStatus(status)) filter.status = status;
  const deptId = searchParams.get("deptId");
  if (deptId) filter.deptId = deptId;
  const limit = Number(searchParams.get("limit") ?? "");
  if (Number.isFinite(limit) && limit > 0) filter.limit = limit;
  const offset = Number(searchParams.get("offset") ?? "");
  if (Number.isFinite(offset) && offset >= 0) filter.offset = offset;

  const result = listUsers(filter);
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: result,
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email : "";
    const displayName = typeof body.displayName === "string" ? body.displayName : "";
    const deptId = typeof body.deptId === "string" ? body.deptId : null;
    const rawStatus = body.status;
    const status = isStatus(rawStatus) ? rawStatus : "active";
    const password = typeof body.password === "string" ? body.password : undefined;

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

    const created = createUser({ email, displayName, deptId, status, password });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { user: created },
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
