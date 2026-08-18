import { getAdminUser } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getQuotaConfig, setQuotaConfig, type QuotaRule } from "../../../../../../lib/token-quota-store";
import { groupQuotaSourceForUser, listUserGroups } from "../../../../../../lib/user-groups-store";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["user:update"]);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const user = await getAdminUser(auth.session.tenantId, id);
    if (!user) return NextResponse.json({ code: "40400", message: "user not found" }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;
    const config = await getQuotaConfig(auth.session.tenantId);
    const users = { ...config.users };
    if (body.inherit === true) {
      const groupSource = groupQuotaSourceForUser(await listUserGroups(auth.session.tenantId), id);
      if (groupSource) {
        users[id] = {
          ...(users[id] as QuotaRule | undefined),
          monthlyTokens: groupSource.monthlyTokens,
          poolScope: "",
          action: "block",
        };
        const quota = await setQuotaConfig(
          { users, updatedAt: config.updatedAt },
          auth.session.tenantId,
        );
        return NextResponse.json({
          code: "00000",
          message: "ok",
          data: { quota: quota.users[id], inherited: true, source: "group", sourceLabel: groupSource.name },
        });
      }
      delete users[id];
      const quota = await setQuotaConfig(
        { users, updatedAt: config.updatedAt },
        auth.session.tenantId,
      );
      return NextResponse.json({ code: "00000", message: "ok", data: { quota: quota.users[id] ?? null, inherited: true, source: "default" } });
    }

    const monthlyTokens = Number(body.monthlyTokens);
    if (!Number.isFinite(monthlyTokens) || monthlyTokens < 0) {
      return NextResponse.json({ code: "40000", message: "monthlyTokens must be a non-negative number" }, { status: 400 });
    }
    const current = users[id] as QuotaRule | undefined;
    users[id] = {
      ...current,
      monthlyTokens: Math.floor(monthlyTokens),
      poolScope: "",
      action: "block",
    };
    const quota = await setQuotaConfig(
      { users, updatedAt: config.updatedAt },
      auth.session.tenantId,
    );
    return NextResponse.json({ code: "00000", message: "ok", data: { quota: quota.users[id], inherited: false } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "invalid request" },
      { status: 400 },
    );
  }
}
