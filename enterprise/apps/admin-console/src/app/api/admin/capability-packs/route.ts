import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../lib/admin-auth";
import { createCapabilityPack, listCapabilityPacks } from "../../../../lib/capability-packs-store";
import { DEFAULT_PACK_INPUT, DEFAULT_PACK_SLUG } from "../../../../lib/default-capability-pack";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const packs = await ensureDefaultPack(await listCapabilityPacks());
    return NextResponse.json({ code: "00000", message: "ok", data: { packs } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load capability packs";
    const hint = /enterprise_capability_packs|relation .* does not exist/i.test(message)
      ? "请先执行 pnpm --filter @agenticx/db-schema db:migrate"
      : message;
    return NextResponse.json({ code: "50000", message: hint }, { status: 500 });
  }
}

/**
 * 首次打开能力包列表时补出「基础能力」包。
 *
 * 只在一个包都没有的时候补：管理员如果把它删了，那是明确的意思表示，不该下次刷新
 * 又冒出来；已经有别的包也说明这个租户已经在用能力包管东西了，不该塞一个他没建的。
 *
 * 补失败不影响列表返回。它只是让「全员默认有搜索」这件事在界面上看得见，不是判定依据。
 */
async function ensureDefaultPack(
  packs: Awaited<ReturnType<typeof listCapabilityPacks>>,
): Promise<typeof packs> {
  if (packs.length > 0) return packs;
  try {
    await createCapabilityPack({ ...DEFAULT_PACK_INPUT, capabilityIds: [...DEFAULT_PACK_INPUT.capabilityIds], assignmentKeys: [...DEFAULT_PACK_INPUT.assignmentKeys] });
    return await listCapabilityPacks();
  } catch (error) {
    console.warn(`[capability-packs] could not seed ${DEFAULT_PACK_SLUG}:`, error);
    return packs;
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
      status?: "active" | "disabled";
      metadata?: Record<string, unknown>;
      capabilityIds?: string[];
      assignmentKeys?: string[];
    };
    if (!body.slug?.trim()) {
      return NextResponse.json({ code: "40000", message: "slug required" }, { status: 400 });
    }
    const pack = await createCapabilityPack({
      slug: body.slug.trim(),
      displayName: body.displayName,
      description: body.description,
      status: body.status,
      metadata: body.metadata,
      capabilityIds: body.capabilityIds,
      assignmentKeys: body.assignmentKeys,
    });
    return NextResponse.json({ code: "00000", message: "ok", data: { pack } });
  } catch (error) {
    return NextResponse.json(
      { code: "40000", message: error instanceof Error ? error.message : "create failed" },
      { status: 400 }
    );
  }
}
