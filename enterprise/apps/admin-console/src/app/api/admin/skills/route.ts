import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { createSkill, listSkills } from "../../../../lib/capability-packs-store";

function migrationHint(message: string): string {
  return /enterprise_skills|relation .* does not exist/i.test(message)
    ? "请先执行 pnpm --filter @agenticx/db-schema db:migrate"
    : message;
}

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const skills = await listSkills();
    return NextResponse.json({ code: "00000", message: "ok", data: { skills } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load skills";
    return NextResponse.json({ code: "50000", message: migrationHint(message) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json()) as {
      slug?: string;
      displayName?: string;
      description?: string;
      version?: string;
      bundleUri?: string;
      bundleDigest?: string;
      requiredCapabilities?: string[];
      status?: "active" | "disabled";
    };
    if (!body.slug?.trim()) {
      return NextResponse.json({ code: "40000", message: "slug required" }, { status: 400 });
    }
    const skill = await createSkill({
      slug: body.slug.trim(),
      displayName: body.displayName,
      description: body.description,
      version: body.version,
      bundleUri: body.bundleUri,
      bundleDigest: body.bundleDigest,
      requiredCapabilities: body.requiredCapabilities,
      status: body.status,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { skill } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "create failed" },
      { status: 400 }
    );
  }
}
