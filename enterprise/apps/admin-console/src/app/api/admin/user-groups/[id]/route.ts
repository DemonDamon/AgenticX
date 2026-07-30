import { getAdminUser } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  applyUserGroupPolicy,
  deleteUserGroup,
  getUserGroup,
  updateUserGroup,
  type UserGroupPolicyMember,
} from "../../../../../lib/user-groups-store";

function memberIdsFrom(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}

function modelIdsFrom(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}

async function resolveKnownMembers(tenantId: string, memberIds: string[]): Promise<UserGroupPolicyMember[]> {
  const rows = await Promise.all(memberIds.map((id) => getAdminUser(tenantId, id)));
  if (rows.some((row) => !row)) throw new Error("one or more members do not exist");
  return rows.map((row) => ({ id: row!.id }));
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const group = await getUserGroup(id);
  if (!group) return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
  return NextResponse.json({ code: "00000", message: "ok", data: { group } });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const memberIds = memberIdsFrom(body.memberIds);
    const modelIds = modelIdsFrom(body.modelIds);
    if (memberIds) await resolveKnownMembers(auth.session.tenantId, memberIds);
    const group = await updateUserGroup(id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.description === "string" || body.description === null ? { description: body.description as string | null } : {}),
      ...(memberIds !== undefined ? { memberIds } : {}),
      ...(body.monthlyTokens !== undefined ? { monthlyTokens: Number(body.monthlyTokens) } : {}),
      ...(modelIds !== undefined ? { modelIds } : {}),
    });
    const members = await resolveKnownMembers(auth.session.tenantId, group.memberIds);
    await applyUserGroupPolicy(group, members);
    return NextResponse.json({ code: "00000", message: "ok", data: { group } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid request";
    const status = message === "user group not found" ? 404 : 400;
    return NextResponse.json({ code: status === 404 ? "40400" : "40000", message }, { status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:update"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const deleted = await deleteUserGroup(id);
  if (!deleted) return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
  return NextResponse.json({ code: "00000", message: "ok", data: { deleted: true } });
}
