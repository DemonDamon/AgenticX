import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../lib/session";
import {
  capabilityStatesFromView,
  loadUserCapabilityView,
} from "../../../../lib/capability-packs-reader";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: { code: "40101", message: "unauthorized" } }, { status: 401 });
  }
  const view = await loadUserCapabilityView(session.userId, session.email, session.deptId);
  const skills = capabilityStatesFromView(view)
    .filter((item) => item.kind === "skill")
    .map((item) => {
      const selectable = item.scanVerdict === "safe" && item.state === "on";
      const reason = selectable
        ? undefined
        : item.state !== "on"
          ? "inactive"
          : item.scanVerdict === "caution" || item.scanVerdict === "dangerous"
            ? item.scanVerdict
            : "unscanned";
      return { id: item.id, displayName: item.displayName, selectable, reason };
    });
  return NextResponse.json({ code: "00000", message: "ok", data: { skills } });
}
