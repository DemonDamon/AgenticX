import { NextResponse } from "next/server";
import { cancelDesktopDeviceAuthRequest } from "../../../../../../lib/desktop-device-auth";

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

  try {
    await cancelDesktopDeviceAuthRequest({ deviceId, deviceSecret });
    return NextResponse.json({ code: "00000", message: "ok" });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "40101") {
      return NextResponse.json(
        { code: "40101", message: "invalid or expired device authorization" },
        { status: 401 },
      );
    }
    if (code === "40901") {
      return NextResponse.json(
        { code: "40901", message: "device authorization not pending" },
        { status: 409 },
      );
    }
    console.error("[desktop/auth/device/cancel] failed:", error instanceof Error ? error.message : "error");
    return NextResponse.json(
      { code: "50000", message: "failed to cancel device authorization" },
      { status: 500 },
    );
  }
}
