import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import {
  ensureSampleProfile,
  listProfiles,
  saveProfile,
  type IdMapProfileRecord,
} from "../../../../../../lib/idmapping-store";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    await ensureSampleProfile();
    const profiles = await listProfiles();
    return NextResponse.json({ code: "00000", message: "ok", data: { profiles } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load profiles";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as Partial<IdMapProfileRecord> & {
      ensure_sample?: boolean;
    };
    if (body.ensure_sample) {
      const profile = await ensureSampleProfile();
      return NextResponse.json({ code: "00000", message: "ok", data: { profile } });
    }
    const profile = await saveProfile(body);
    return NextResponse.json({ code: "00000", message: "ok", data: { profile } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "save failed";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
