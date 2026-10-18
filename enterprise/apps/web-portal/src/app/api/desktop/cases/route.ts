import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { casePackageFile, isViewPackageManifest } from "@agenticx/db-schema";
import { createEnterpriseCase, listEnterpriseCases } from "@agenticx/iam-core";
import { ulid } from "ulid";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";

const MAX_PACKAGE_BYTES = 12 * 1024 * 1024;

function migrationHint(message: string): string {
  return /enterprise_cases|relation .* does not exist|ER_NO_SUCH_TABLE|doesn't exist/i.test(message)
    ? "请先执行 pnpm --filter @agenticx/db-schema db:migrate"
    : message;
}

export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json({ code: "40101", message: "企业登录已失效，请重新登录" }, { status: 401 });
  }
  const scope = new URL(request.url).searchParams.get("scope");
  try {
    const cases =
      scope === "mine"
        ? await listEnterpriseCases(identity.tenantId, { submitterUserId: identity.userId })
        : await listEnterpriseCases(identity.tenantId, { status: "published" });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        cases: cases.map((item) => ({
          id: item.id,
          title: item.title,
          summary: item.summary,
          sourceRepo: item.sourceRepo,
          status: item.status,
          submitterUserId: item.submitterUserId,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to list cases";
    return NextResponse.json({ code: "50000", message: migrationHint(message) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json({ code: "40101", message: "企业登录已失效，请重新登录" }, { status: 401 });
  }
  const body = (await request.json()) as {
    title?: string;
    summary?: string;
    sourceRepo?: string;
    manifest?: unknown;
    packageBase64?: string;
  };
  const title = body.title?.trim() ?? "";
  if (!title) {
    return NextResponse.json({ code: "40000", message: "title required" }, { status: 400 });
  }
  if (!isViewPackageManifest(body.manifest)) {
    return NextResponse.json({ code: "40000", message: "manifest must be agx-view-package/1" }, { status: 400 });
  }
  const zip = Buffer.from(String(body.packageBase64 ?? ""), "base64");
  if (zip.length === 0 || zip.length > MAX_PACKAGE_BYTES) {
    return NextResponse.json({ code: "40000", message: "package is empty or too large" }, { status: 400 });
  }
  const id = ulid();
  const filePath = casePackageFile(identity.tenantId, id);
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, zip);
    const created = await createEnterpriseCase({
      id,
      tenantId: identity.tenantId,
      title,
      summary: body.summary?.trim() ?? "",
      sourceRepo: body.sourceRepo?.trim() ?? "",
      submitterUserId: identity.userId,
      manifest: body.manifest as Record<string, unknown>,
      packagePath: filePath,
    });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { id: created.id, status: created.status },
    });
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    const message = error instanceof Error ? error.message : "failed to submit case";
    return NextResponse.json({ code: "50000", message: migrationHint(message) }, { status: 500 });
  }
}
