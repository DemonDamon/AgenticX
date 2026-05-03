import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionFromCookies } from "../../../../lib/session";
import { ACCESS_COOKIE } from "../../../../lib/session";
import { isChatSessionOwned } from "../../../../lib/chat-history";
import { toChatHistoryContext } from "../../../../lib/chat-history-http";

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

  const chatSessionId = request.headers.get("x-chat-session-id")?.trim();
  if (!chatSessionId) {
    return NextResponse.json(
      {
        error: {
          code: "40001",
          message: "missing chat session",
        },
      },
      { status: 400 }
    );
  }

  const ctx = toChatHistoryContext(session);
  const owned = await isChatSessionOwned(ctx, chatSessionId);
  if (!owned) {
    return NextResponse.json(
      {
        error: {
          code: "40301",
          message: "forbidden",
        },
      },
      { status: 403 }
    );
  }

  const rawBody = await request.text();
  let providerHint = "";
  let forwardBody = rawBody;
  // portal 把模型 id 编码为 "<provider>/<model>"；admin 配置好的 provider 与上游 endpoint 一一对应。
  // gateway 用 model 字段查表，所以这里把 provider 拆出来放请求头，body.model 仅保留模型名。
  try {
    const parsed = JSON.parse(rawBody) as { model?: string };
    if (typeof parsed.model === "string" && parsed.model.includes("/")) {
      const [providerId, ...rest] = parsed.model.split("/");
      const modelName = rest.join("/");
      if (providerId && modelName) {
        providerHint = providerId;
        forwardBody = JSON.stringify({ ...parsed, model: modelName });
      }
    }
  } catch {
    // body 不是 JSON 时维持原样转发
  }

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
      ...(providerHint ? { "x-agenticx-provider": providerHint } : {}),
    },
    body: forwardBody,
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

