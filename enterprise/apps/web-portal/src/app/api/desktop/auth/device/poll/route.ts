import { NextResponse } from "next/server";
import { pollDesktopDeviceAuth } from "../../../../../../lib/desktop-device-auth";
import {
  clientIpFromRequest,
  takeToken,
} from "../../../../../../lib/desktop-device-rate-limit";

export async function POST(request: Request) {
  let body: { deviceId?: string; deviceSecret?: string };
  try {
    body = (await request.json()) as { deviceId?: string; deviceSecret?: string };
  } catch {
    return NextResponse.json(
      { code: "40000", message: "invalid json body" },
      { status: 400 },
    );
  }

  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const deviceSecret = typeof body.deviceSecret === "string" ? body.deviceSecret : "";
  if (!deviceId || !deviceSecret) {
    return NextResponse.json(
      { code: "40000", message: "deviceId and deviceSecret are required" },
      { status: 400 },
    );
  }

  const ip = clientIpFromRequest(request);
  if (
    !takeToken(`device-poll:${deviceId}`, 120, 60_000) ||
    !takeToken(`device-poll-ip:${ip}`, 300, 60_000)
  ) {
    return NextResponse.json(
      { code: "42900", message: "请求过于频繁，请稍后再试" },
      { status: 429 },
    );
  }

  try {
    const result = await pollDesktopDeviceAuth({ deviceId, deviceSecret });
    if (result.status === "pending" || result.status === "issuing") {
      return NextResponse.json({
        code: "00000",
        message: "ok",
        data: { status: "pending" },
      });
    }
    if (result.status === "completed") {
      return NextResponse.json({
        code: "00000",
        message: "ok",
        data: {
          status: "completed",
          token: result.token,
          tokenId: result.tokenId,
          user: result.user,
          expiresAt: result.expiresAt,
        },
      });
    }
    return NextResponse.json(
      {
        code: "41001",
        message: "device authorization no longer available",
        data: { status: result.status },
      },
      { status: 410 },
    );
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "40101") {
      return NextResponse.json(
        { code: "40101", message: "invalid or expired device authorization" },
        { status: 401 },
      );
    }
    console.error("[desktop/auth/device/poll] failed:", error instanceof Error ? error.message : "error");
    return NextResponse.json(
      { code: "50000", message: "failed to poll device authorization" },
      { status: 500 },
    );
  }
}
