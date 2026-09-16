import { NextResponse } from "next/server";
import {
  buildDesktopVerificationUrl,
  requestOriginFromRequest,
  startDesktopDeviceAuth,
} from "../../../../../../lib/desktop-device-auth";
import {
  clientIpFromRequest,
  takeToken,
} from "../../../../../../lib/desktop-device-rate-limit";

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  if (!takeToken(`device-init:${ip}`, 20, 3_600_000)) {
    return NextResponse.json(
      { code: "42900", message: "请求过于频繁，请稍后再试" },
      { status: 429 },
    );
  }

  let body: { deviceName?: string } = {};
  try {
    body = (await request.json()) as { deviceName?: string };
  } catch {
    body = {};
  }

  try {
    const started = await startDesktopDeviceAuth({
      deviceName: typeof body.deviceName === "string" ? body.deviceName : undefined,
    });
    const origin = requestOriginFromRequest(request);
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: {
        deviceId: started.deviceId,
        deviceSecret: started.deviceSecret,
        verificationUrl: buildDesktopVerificationUrl(origin, started.deviceId),
        expiresIn: started.expiresIn,
        pollIntervalMs: started.pollIntervalMs,
      },
    });
  } catch (error) {
    console.error("[desktop/auth/device/init] failed:", error instanceof Error ? error.message : "error");
    return NextResponse.json(
      { code: "50000", message: "failed to start device authorization" },
      { status: 500 },
    );
  }
}
