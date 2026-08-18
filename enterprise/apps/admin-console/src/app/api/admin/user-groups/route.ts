import { getAdminUser } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import {
  applyUserGroupPolicy,
  createUserGroup,
  listUserGroups,
  type UserGroupInput,
  type UserGroupPolicyMember,
} from "../../../../lib/user-groups-store";

function memberIdsFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}

function modelIdsFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
}

async function resolveKnownMembers(tenantId: string, memberIds: string[]): Promise<UserGroupPolicyMember[]> {
  const rows = await Promise.all(memberIds.map((id) => getAdminUser(tenantId, id)));
  if (rows.some((row) => !row)) throw new Error("one or more members do not exist");
  return rows.map((row) => ({ id: row!.id }));
}

export async function GET() {
  const auth = await requireAdminScope(["user:read"]);
  if (!auth.ok) return auth.response;
  const items = await listUserGroups(auth.session.tenantId);
  return NextResponse.json({ code: "00000", message: "ok", data: { items } });
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["user:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const memberIds = memberIdsFrom(body.memberIds);
    const members = await resolveKnownMembers(auth.session.tenantId, memberIds);
    const group = await createUserGroup(auth.session.tenantId, {
      name: typeof body.name === "string" ? body.name : "",
      description: typeof body.description === "string" ? body.description : null,
      memberIds,
      monthlyTokens: typeof body.monthlyTokens === "number" ? body.monthlyTokens : Number(body.monthlyTokens ?? 0),
      modelIds: modelIdsFrom(body.modelIds),
    } satisfies UserGroupInput);
    await applyUserGroupPolicy(auth.session.tenantId, group, members);
    return NextResponse.json({ code: "00000", message: "ok", data: { group } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 },
    );
  }
}
