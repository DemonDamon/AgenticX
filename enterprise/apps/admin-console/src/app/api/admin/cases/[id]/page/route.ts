import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { casePageFile, readStoreZip } from "@agenticx/db-schema";
import { getEnterpriseCase } from "@agenticx/iam-core";
import { requireAdminScope } from "../../../../../../lib/admin-auth";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const file = new URL(request.url).searchParams.get("file") ?? "";
  const item = await getEnterpriseCase(auth.session.tenantId, id);
  if (!item) {
    return NextResponse.json({ code: "40400", message: "案例不存在" }, { status: 404 });
  }
  const pageFile = casePageFile(item.manifest, file);
  if (!pageFile) {
    return NextResponse.json({ code: "40000", message: "这个页面不在案例包里" }, { status: 400 });
  }
  try {
    const zip = await readFile(item.packagePath);
    const entry = readStoreZip(zip).find((candidate) => candidate.name === pageFile);
    if (!entry) {
      return NextResponse.json({ code: "40400", message: "案例包里没有这个页面" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(entry.data), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ code: "40400", message: "案例包打不开，页面暂时无法预览" }, { status: 404 });
  }
}
