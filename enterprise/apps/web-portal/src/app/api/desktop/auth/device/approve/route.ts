import { NextResponse } from "next/server";
import { approveDesktopDeviceForSession } from "../../../../../../lib/desktop-device-auth";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../../lib/session";

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) {
    return passwordChangeRequiredResponse();
  }
  if (!session) {
    return NextResponse.json(
      { code: "40101", message: "请先登录企业账号" },
      { status: 401 },
    );
  }

  let body: { deviceId?: string };
  try {
    body = (await request.json()) as { deviceId?: string };
  } catch {
    return NextResponse.json(
      { code: "40000", message: "invalid json body" },
      { status: 400 },
    );
  }

  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  if (!deviceId) {
    return NextResponse.json(
      { code: "40000", message: "deviceId is required" },
      { status: 400 },
    );
  }

  try {
    await approveDesktopDeviceForSession({
      deviceId,
      tenantId: session.tenantId,
      userId: session.userId,
      deptId: session.deptId ?? null,
    });
    return NextResponse.json({
      code: "00000",
      message: "已授权，可关闭此页并返回和创智派 Desktop",
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "40401") {
      return NextResponse.json(
        { code: "40401", message: "授权请求不存在或已失效" },
        { status: 404 },
      );
    }
    if (code === "40301") {
      return NextResponse.json(
        { code: "40301", message: "无权批准此授权请求" },
        { status: 403 },
      );
    }
    if (code === "41001") {
      return NextResponse.json(
        { code: "41001", message: "授权请求已过期" },
        { status: 410 },
      );
    }
    if (code === "40901") {
      return NextResponse.json(
        { code: "40901", message: "授权请求状态不可用" },
        { status: 409 },
      );
    }
    console.error("[desktop/auth/device/approve] failed:", error instanceof Error ? error.message : "error");
    return NextResponse.json(
      { code: "50000", message: "failed to approve device authorization" },
      { status: 500 },
    );
  }
}
