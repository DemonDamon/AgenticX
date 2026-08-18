import { NextResponse } from "next/server";
import { resolveDesktopIdentity } from "../../../../../../lib/desktop-auth";
import { prepareGatewayForward } from "../../../../../../lib/gateway-forward";

const GATEWAY_COMPLETIONS_URL =
  process.env.GATEWAY_COMPLETIONS_URL ?? "http://127.0.0.1:8088/v1/chat/completions";

const AGENTIC_REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function forwardedAgenticRequestId(request: Request, header: string): string {
  const value = request.headers.get(header)?.trim() ?? "";
  return AGENTIC_REQUEST_ID_RE.test(value) ? value : "";
}

function extractBearer(request: Request): string {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? "";
}

function enrichQuotaErrorBody(status: number, errorBody: string): string {
  const looksQuota =
    status === 429 ||
    /quota|额度|限流|rate.?limit/i.test(errorBody);
  if (!looksQuota) return errorBody;
  try {
    const parsed = JSON.parse(errorBody) as Record<string, unknown>;
    const err = (parsed.error ?? parsed) as Record<string, unknown>;
    const message =
      (typeof err.message === "string" && err.message) ||
      (typeof parsed.message === "string" && parsed.message) ||
      "已超出企业配额，请联系管理员";
    return JSON.stringify({
      ...parsed,
      error: {
        ...(typeof parsed.error === "object" && parsed.error ? parsed.error : {}),
        code: (err as { code?: string }).code ?? "42901",
        message,
      },
      message,
    });
  } catch {
    return JSON.stringify({
      error: { code: "42901", message: "已超出企业配额，请联系管理员" },
      message: "已超出企业配额，请联系管理员",
    });
  }
}

export async function POST(request: Request) {
  const identity = await resolveDesktopIdentity(request);
  if (!identity) {
    return NextResponse.json(
      {
        error: {
          code: "40101",
          message: "企业登录已失效，请重新登录",
        },
      },
      { status: 401 },
    );
  }

  const pat = extractBearer(request);
  const turnId = forwardedAgenticRequestId(request, "x-agenticx-turn-id");
  const traceId = forwardedAgenticRequestId(request, "x-agenticx-trace-id");
  const rawBody = await request.text();
  const prepared = await prepareGatewayForward(rawBody, {
    userId: identity.userId,
    email: identity.email,
    deptId: identity.deptId,
  });
  if ("error" in prepared) {
    return NextResponse.json(
      { error: { code: prepared.error.code, message: prepared.error.message } },
      { status: prepared.error.status },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(GATEWAY_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${pat}`,
        "x-tenant-id": identity.tenantId,
        "x-user-id": identity.userId,
        "x-dept-id": identity.deptId ?? "",
        "x-user-email": identity.email,
        ...(turnId ? { "x-agenticx-turn-id": turnId } : {}),
        ...(traceId ? { "x-agenticx-trace-id": traceId } : {}),
        ...(prepared.providerHint ? { "x-agenticx-provider": prepared.providerHint } : {}),
      },
      body: prepared.forwardBody,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "gateway unreachable";
    return NextResponse.json(
      {
        error: {
          code: "50301",
          message: `Gateway 不可用（${GATEWAY_COMPLETIONS_URL}）：${detail}`,
        },
      },
      { status: 503 },
    );
  }

  if (!upstream.ok) {
    const errorBody = await upstream.text();
    const body = enrichQuotaErrorBody(upstream.status, errorBody);
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "content-type": "application/json" },
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
