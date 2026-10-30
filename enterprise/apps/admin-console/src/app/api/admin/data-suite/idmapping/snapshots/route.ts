import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import {
  getSnapshotCompare,
  listSnapshotIds,
  loadSnapshot,
} from "../../../../../../lib/idmapping-store";

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const left = url.searchParams.get("left");
    const right = url.searchParams.get("right");
    const id = url.searchParams.get("id");
    if (left && right) {
      const compared = await getSnapshotCompare(left, right);
      return NextResponse.json({ code: "00000", message: "ok", data: compared });
    }
    if (id) {
      const snapshot = await loadSnapshot(id);
      return NextResponse.json({ code: "00000", message: "ok", data: { snapshot } });
    }
    const snapshot_ids = await listSnapshotIds();
    return NextResponse.json({ code: "00000", message: "ok", data: { snapshot_ids } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load snapshots";
    return NextResponse.json({ code: "40000", message }, { status: 400 });
  }
}
