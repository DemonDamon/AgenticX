import { NextResponse } from "next/server";
import { casePageFile } from "@agenticx/db-schema";
import { getEnterpriseCase } from "@agenticx/iam-core";
import { requireAdminScope } from "../../../../../lib/admin-auth";

function pagesFromManifest(manifest: Record<string, unknown>) {
  const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
  return pages.flatMap((page) => {
    if (!page || typeof page !== "object" || Array.isArray(page)) return [];
    const record = page as { id?: unknown; file?: unknown; title?: unknown };
    const file = casePageFile(manifest, String(record.file ?? ""));
    if (!file) return [];
    return [{
      id: String(record.id ?? file),
      file,
      title: String(record.title ?? file),
    }];
  });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const item = await getEnterpriseCase(auth.session.tenantId, id);
  if (!item) {
    return NextResponse.json({ code: "40400", message: "案例不存在" }, { status: 404 });
  }
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      case: {
        id: item.id,
        title: item.title,
        summary: item.summary,
        sourceRepo: item.sourceRepo,
        status: item.status,
        updatedAt: item.updatedAt,
        pages: pagesFromManifest(item.manifest),
      },
    },
  });
}
