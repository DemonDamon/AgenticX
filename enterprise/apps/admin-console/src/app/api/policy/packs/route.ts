import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { listPolicyPacks, policyOverridePath } from "../../../../lib/policy-store";

export async function GET() {
  const guard = await requireAdminScope(["policy:read"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      packs: listPolicyPacks(),
      override_file: policyOverridePath(),
    },
  });
}
