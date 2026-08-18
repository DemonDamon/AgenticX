import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import {
  getQuotaConfig,
  QuotaConfigConflictError,
  quotaFilePath,
  setQuotaConfig,
  type QuotaConfig,
} from "../../../../lib/token-quota-store";

const ALLOWED_KEYS = new Set([
  "expectedUpdatedAt",
  "defaults",
  "users",
  "departments",
  "groups",
  "modelExclusions",
  "apiTokens",
]);

export async function GET() {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { quota: await getQuotaConfig(guard.session.tenantId), file: quotaFilePath() },
  });
}

export async function PUT(request: Request) {
  const guard = await requireAdminScope(["metering:manage"]);
  if (!guard.ok) return guard.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ code: "40001", message: "body must be an object" }, { status: 400 });
  }
  const row = body as Record<string, unknown>;
  const unknownKeys = Object.keys(row).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      { code: "40001", message: `unknown fields: ${unknownKeys.join(", ")}` },
      { status: 400 },
    );
  }
  const expectedUpdatedAt = row.expectedUpdatedAt;
  if (
    typeof expectedUpdatedAt !== "string" ||
    !expectedUpdatedAt.trim() ||
    Number.isNaN(new Date(expectedUpdatedAt).getTime())
  ) {
    return NextResponse.json(
      { code: "40001", message: "expectedUpdatedAt is required" },
      { status: 400 },
    );
  }
  const patch = { ...row };
  delete patch.expectedUpdatedAt;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ code: "40001", message: "empty quota patch" }, { status: 400 });
  }
  try {
    const quota = await setQuotaConfig(
      patch as Partial<QuotaConfig>,
      guard.session.tenantId,
      expectedUpdatedAt,
    );
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { quota, file: quotaFilePath() },
    });
  } catch (error) {
    if (error instanceof QuotaConfigConflictError) {
      return NextResponse.json(
        { code: "40901", message: "quota config changed; reload and retry" },
        { status: 409 },
      );
    }
    throw error;
  }
}
