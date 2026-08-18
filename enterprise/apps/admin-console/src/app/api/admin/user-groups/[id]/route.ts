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

async function resolveExistingMembers(
  tenantId: string,
  memberIds: string[],
): Promise<{ members: UserGroupPolicyMember[]; missingMemberIds: string[] }> {
  const rows = await Promise.all(memberIds.map((id) => getAdminUser(tenantId, id)));
  const members: UserGroupPolicyMember[] = [];
  const missingMemberIds: string[] = [];
  rows.forEach((row, index) => {
    if (row) members.push({ id: row.id });
    else missingMemberIds.push(memberIds[index]!);
  });
  return { members, missingMemberIds };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const group = await getUserGroup(auth.session.tenantId, id);
  if (!group) return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
  const resolved = await resolveExistingMembers(auth.session.tenantId, group.memberIds);
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      group: {
        ...group,
        memberIds: resolved.members.map((member) => member.id),
      },
    },
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:update"]);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const memberIds = memberIdsFrom(body.memberIds);
    const modelIds = modelIdsFrom(body.modelIds);
    const current = await getUserGroup(auth.session.tenantId, id);
    if (!current) throw new Error("user group not found");
    const resolved = await resolveExistingMembers(
      auth.session.tenantId,
      memberIds ?? current.memberIds,
    );
    const existingMemberIds = resolved.members.map((member) => member.id);
    const group = await updateUserGroup(auth.session.tenantId, id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.description === "string" || body.description === null ? { description: body.description as string | null } : {}),
      memberIds: existingMemberIds,
      ...(body.monthlyTokens !== undefined ? { monthlyTokens: Number(body.monthlyTokens) } : {}),
      ...(modelIds !== undefined ? { modelIds } : {}),
    });
    await applyUserGroupPolicy(auth.session.tenantId, group, resolved.members);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        group,
        removedMissingMembers: resolved.missingMemberIds.length,
      },
    });
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
  const deleted = await deleteUserGroup(auth.session.tenantId, id);
  if (!deleted) return NextResponse.json({ code: "40400", message: "not found" }, { status: 404 });
  return NextResponse.json({ code: "00000", message: "ok", data: { deleted: true } });
}
