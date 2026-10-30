import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import {
  SAMPLE_PROFILE_NAME,
  SAMPLE_RECORDS,
  ensureSampleProfile,
  mergeAndEnqueue,
} from "../../../../../../lib/idmapping-store";

type Body = {
  profile_name?: string;
  records?: Array<Record<string, unknown>>;
  use_sample?: boolean;
};

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    await ensureSampleProfile();
    const body = (await request.json()) as Body;
    const profileName = String(body.profile_name || SAMPLE_PROFILE_NAME).trim();
    const records =
      body.use_sample || !Array.isArray(body.records) || body.records.length === 0
        ? SAMPLE_RECORDS
        : body.records;
    const result = await mergeAndEnqueue(profileName, records);
    return NextResponse.json({ code: "00000", message: "ok", data: { result } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "merge failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
