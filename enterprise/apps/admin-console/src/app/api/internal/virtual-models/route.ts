import { NextResponse } from "next/server";

import { gatewayInternalUnauthorized, isGatewayInternalAuthorized } from "../../../../lib/gateway-internal-auth";
import { listVirtualModelsInternal } from "../../../../lib/virtual-models-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isGatewayInternalAuthorized(request)) return gatewayInternalUnauthorized();
  try {
    const rows = await listVirtualModelsInternal();
    return NextResponse.json(
      {
        virtualModels: rows.map((row) => ({
          tenantId: row.tenantId,
          name: row.name,
          displayName: row.displayName,
          enabled: row.enabled,
          targets: row.targets,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "virtual_models_bundle_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
