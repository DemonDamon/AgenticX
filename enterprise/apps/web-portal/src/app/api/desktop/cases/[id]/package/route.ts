import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getEnterpriseCase } from "@agenticx/iam-core";
import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json({ code: "40101", message: "企业登录已失效，请重新登录" }, { status: 401 });
  }
  const { id } = await context.params;
  const item = await getEnterpriseCase(identity.tenantId, id).catch(() => null);
  if (!item || !item.packagePath) {
    return NextResponse.json({ code: "40400", message: "case not found" }, { status: 404 });
  }
  const visible = item.status === "published" || item.submitterUserId === identity.userId;
  if (!visible) {
    return NextResponse.json({ code: "40400", message: "case not found" }, { status: 404 });
  }
  try {
    const zip = await readFile(item.packagePath);
    return new NextResponse(zip, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${id}.zip"`,
      },
    });
  } catch {
    return NextResponse.json({ code: "40400", message: "package file missing" }, { status: 404 });
  }
}
