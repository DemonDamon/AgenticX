import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { getQuotaConfig, setQuotaConfig } from "../../../../lib/token-quota-store";

const FEATURE_USAGE_FIELDS = new Set([
  "searchCallsPerDay",
  "searchCallsPerWeek",
  "searchCallsPerMonth",
  "deepResearchRunsPerDay",
  "deepResearchRunsPerWeek",
  "deepResearchRunsPerMonth",
]);

function invalidRule(value: unknown, path: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!FEATURE_USAGE_FIELDS.has(key)) return `${path}.${key} is not a feature usage field`;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
      return `${path}.${key} must be a non-negative integer`;
    }
  }
  return null;
}

function invalidRuleMap(value: unknown, path: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
  for (const [id, rule] of Object.entries(value as Record<string, unknown>)) {
    const problem = invalidRule(rule, `${path}.${id}`);
    if (problem) return problem;
  }
  return null;
}

/** Reject a featureUsage document that is not the ceiling contract. 0 means unlimited. */
function invalidFeatureUsage(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "featureUsage must be an object";
  const record = value as Record<string, unknown>;
  const allowed = new Set(["defaults", "company", "departments", "groups", "users"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return `featureUsage.${key} is not a feature usage field`;
  }
  if (record.defaults !== undefined) {
    if (!record.defaults || typeof record.defaults !== "object" || Array.isArray(record.defaults)) {
      return "featureUsage.defaults must be an object";
    }
    const defaults = record.defaults as Record<string, unknown>;
    for (const key of Object.keys(defaults)) {
      if (key !== "role") return `featureUsage.defaults.${key} is not a feature usage field`;
    }
    if (defaults.role !== undefined) {
      const problem = invalidRuleMap(defaults.role, "featureUsage.defaults.role");
      if (problem) return problem;
    }
  }
  if (record.company !== undefined) {
    const problem = invalidRule(record.company, "featureUsage.company");
    if (problem) return problem;
  }
  for (const scope of ["departments", "groups", "users"] as const) {
    if (record[scope] !== undefined) {
      const problem = invalidRuleMap(record[scope], `featureUsage.${scope}`);
      if (problem) return problem;
    }
  }
  return null;
}

export async function GET() {
  const guard = await requireAdminScope(["metering:read"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { quota: await getQuotaConfig() },
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
  if (body && typeof body === "object" && !Array.isArray(body) && "featureUsage" in body) {
    const problem = invalidFeatureUsage((body as Record<string, unknown>).featureUsage);
    if (problem) {
      return NextResponse.json({ code: "40001", message: problem }, { status: 400 });
    }
  }
  const quota = await setQuotaConfig((body as Record<string, unknown>) ?? {});
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { quota },
  });
}
