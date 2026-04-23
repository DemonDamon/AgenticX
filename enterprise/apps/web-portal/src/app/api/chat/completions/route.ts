import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionFromCookies } from "../../../../lib/session";
import { ACCESS_COOKIE } from "../../../../lib/session";

const GATEWAY_COMPLETIONS_URL =
  process.env.GATEWAY_COMPLETIONS_URL ?? "http://127.0.0.1:8088/v1/chat/completions";

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json(
      {
        error: {
          code: "40101",
          message: "unauthorized",
        },
      },
      { status: 401 }
    );
  }
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json(
      {
        error: {
          code: "40101",
          message: "missing access token",
        },
      },
      { status: 401 }
    );
  }

  const body = await request.text();
  const upstream = await fetch(GATEWAY_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      "x-tenant-id": session.tenantId,
      "x-user-id": session.userId,
      "x-dept-id": session.deptId ?? "",
      "x-user-email": session.email,
      "x-session-id": session.sessionId,
    },
    body,
  });

  if (!upstream.ok) {
    const errorBody = await upstream.text();
    return new NextResponse(errorBody, {
      status: upstream.status,
      headers: {
        "content-type": "application/json",
      },
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

