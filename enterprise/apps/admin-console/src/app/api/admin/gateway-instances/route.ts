import { NextResponse } from "next/server";
import { buildPolicySnapshotBundleForGateway } from "@agenticx/feature-policy";

import { requireAdminScope } from "../../../../lib/admin-auth";
import { listGatewayInstances } from "../../../../lib/gateway-instances-store";
import { classifyReplica, policyPublishVersion } from "../../../../lib/gateway-replica-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const bundle = await buildPolicySnapshotBundleForGateway();
    const publishedPolicyVersion = policyPublishVersion(
      Object.entries(bundle.tenants).map(([tenantId, snapshot]) => ({
        tenantId,
        publishId: typeof snapshot.publishId === "string" ? snapshot.publishId : "",
      })),
    );
    const now = new Date();
    const instances = (await listGatewayInstances()).map((row) => ({
      instanceId: row.instanceId,
      lastSeenAt: row.lastSeenAt.toISOString(),
      status: classifyReplica({
        lastSeenAt: row.lastSeenAt,
        now,
        domains: row.statusJson.domains,
        publishedPolicyVersion,
      }),
      domains: row.statusJson.domains.map((domain) => ({
        domain: domain.domain,
        appliedAt: domain.appliedAt,
        version: domain.version,
        lastError: domain.lastError,
        contentHash: domain.contentHash,
      })),
    }));
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { publishedPolicyVersion, instances },
    });
  } catch {
    return NextResponse.json({ code: "50000", message: "gateway instances unavailable" }, { status: 500 });
  }
}
