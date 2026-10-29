import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../lib/session";
import { reseedSamples } from "../../../../lib/disambiguation-runtime-store";

export async function POST() {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ code: "40100", message: "unauthorized" }, { status: 401 });
  }
  try {
    const sessions = await reseedSamples();
    return NextResponse.json({ code: "00000", message: "ok", data: { sessions } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "seed failed";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
