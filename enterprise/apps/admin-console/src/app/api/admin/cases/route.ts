import { NextResponse } from "next/server";
import { listEnterpriseCases } from "@agenticx/iam-core";
import { requireAdminScope } from "../../../../lib/admin-auth";

function migrationHint(message: string): string {
  return /enterprise_cases|relation .* does not exist|ER_NO_SUCH_TABLE|doesn't exist/i.test(message)
    ? "请先执行 pnpm --filter @agenticx/db-schema db:migrate"
    : message;
}

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const cases = await listEnterpriseCases(auth.session.tenantId);
    return NextResponse.json({ code: "00000", message: "ok", data: { cases } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to list cases";
    return NextResponse.json({ code: "50000", message: migrationHint(message) }, { status: 500 });
  }
}
