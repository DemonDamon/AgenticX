import { NextResponse } from "next/server";
import { getAdminSession } from "../../../../lib/admin-auth";

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      email: session.email,
      role: "admin",
    },
  });
}

