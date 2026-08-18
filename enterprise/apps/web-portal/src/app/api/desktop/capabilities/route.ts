import { NextResponse } from "next/server";

import {
  capabilityStatesFromView,
  loadUserCapabilityView,
} from "../../../../lib/capability-packs-reader";
import { setUserCapabilityPreference } from "../../../../lib/capability-opt-outs-store";
import { resolveDesktopIdentity } from "../../../../lib/desktop-auth";

/**
 * 「我的能力」：列出企业分配给我的能力，含被我自己关掉的那些。
 *
 * 与 bootstrap 的差别正在这里 —— bootstrap 下发的是当下能调用的，关掉的不在其中；
 * 这个接口要连关掉的一起给，否则关了之后就没有地方再打开。
 */
export async function GET(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json({ code: "40101", message: "企业登录已失效，请重新登录" }, { status: 401 });
  }
  try {
    const view = await loadUserCapabilityView(identity.userId, identity.email, identity.deptId);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { capabilities: capabilityStatesFromView(view) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to load capabilities";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json({ code: "40101", message: "企业登录已失效，请重新登录" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    capabilityId?: unknown;
    enabled?: unknown;
  };
  const capabilityId = typeof body.capabilityId === "string" ? body.capabilityId.trim() : "";
  if (!capabilityId) {
    return NextResponse.json({ code: "40001", message: "capabilityId required" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ code: "40001", message: "enabled must be a boolean" }, { status: 400 });
  }

  try {
    const result = await setUserCapabilityPreference(
      identity.userId,
      identity.email,
      identity.deptId,
      capabilityId,
      body.enabled,
    );
    if (!result.ok) {
      // 企业没启用时开启请求必须失败，而不是先存下等企业放开再生效。
      return NextResponse.json(
        { code: "40301", message: "该能力由企业统一管理，当前不可开启" },
        { status: 403 },
      );
    }
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { capabilities: result.capabilities },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to update capability";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
