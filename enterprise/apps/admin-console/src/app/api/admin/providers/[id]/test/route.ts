import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../../lib/admin-auth";
import { getProviderInternal } from "../../../../../../lib/model-providers-store";

const MODELS_PROBE_MS = 4000;
const CHAT_PROBE_MS = 30000;

/**
 * 触发对上游 OpenAI 兼容端点的轻量探活：
 *   1) 优先 GET <baseUrl>/models（OpenAI 兼容惯例，短超时）
 *   2) 失败/超时回落 POST 一条 1 token 的 chat.completions（避免厂商不实现 /models 或 /models 挂起）
 *
 * 任一步成功即视为连通；401/403 视为「地址可达但 Key 无效」。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const provider = await getProviderInternal(id);
  if (!provider) {
    return NextResponse.json({ code: "40400", message: "provider not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    apiKey?: string;
    baseUrl?: string;
    probeModel?: string;
  };
  const apiKey = (body.apiKey ?? provider.apiKey ?? "").trim();
  const baseUrl = (body.baseUrl ?? provider.baseUrl).trim().replace(/\/$/, "");
  if (!baseUrl) {
    return NextResponse.json(
      { code: "40000", message: "API 地址未配置；请先填入再测试", data: { reachable: false } },
      { status: 400 }
    );
  }
  if (!apiKey) {
    return NextResponse.json(
      { code: "40000", message: "API Key 未配置；请先填入再测试", data: { reachable: false } },
      { status: 400 }
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // step 1: GET /models（短超时；超时/网络错误继续 step 2）
  const modelsCtrl = new AbortController();
  const modelsTimer = setTimeout(() => modelsCtrl.abort(), MODELS_PROBE_MS);
  try {
    const res = await fetch(`${baseUrl}/models`, { method: "GET", headers, signal: modelsCtrl.signal });
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const count = Array.isArray((json as { data?: unknown[] }).data)
        ? (json as { data: unknown[] }).data.length
        : 0;
      return NextResponse.json({
        code: "00000",
        message: "ok",
        data: {
          reachable: true,
          via: "GET /models",
          modelCount: count,
        },
      });
    }
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({
        code: "40000",
        message: "API 地址可达，但 Key 无效或未授权",
        data: { reachable: false, status: res.status, via: "GET /models" },
      });
    }
    if (res.status !== 404 && res.status !== 405) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({
        code: "40000",
        message: `上游返回 ${res.status}`,
        data: { reachable: false, status: res.status, preview: text.slice(0, 400), via: "GET /models" },
      });
    }
  } catch {
    // 超时/网络错误：回落 chat/completions（移动云 MOMA 等 /models 可能挂起）
  } finally {
    clearTimeout(modelsTimer);
  }

  // step 2: POST minimal chat.completions
  const chatCtrl = new AbortController();
  const chatTimer = setTimeout(() => chatCtrl.abort(), CHAT_PROBE_MS);
  try {
    const probeModel =
      (body.probeModel ?? "").trim() ||
      provider.models.find((m) => m.enabled)?.name ||
      provider.models[0]?.name ||
      "gpt-4o-mini";
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal: chatCtrl.signal,
      body: JSON.stringify({
        model: probeModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
    });
    if (res.ok) {
      return NextResponse.json({
        code: "00000",
        message: "ok",
        data: { reachable: true, via: "POST /chat/completions", probeModel },
      });
    }
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({
        code: "40000",
        message: "API 地址可达，但 Key 无效或未授权",
        data: { reachable: false, status: res.status, via: "POST /chat/completions", probeModel },
      });
    }
    const text = await res.text().catch(() => "");
    return NextResponse.json({
      code: "40000",
      message: `上游返回 ${res.status}${res.status === 404 ? "（请确认已添加模型且 name 为上游真实 ID，如 minimax/minimax-m3）" : ""}`,
      data: {
        reachable: false,
        status: res.status,
        preview: text.slice(0, 400),
        via: "POST /chat/completions",
        probeModel,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json({
        code: "40400",
        message: `连通超时（${Math.round(CHAT_PROBE_MS / 1000)}s）`,
        data: { reachable: false, via: "POST /chat/completions" },
      });
    }
    return NextResponse.json({
      code: "50000",
      message: error instanceof Error ? error.message : "网络错误",
      data: { reachable: false },
    });
  } finally {
    clearTimeout(chatTimer);
  }
}
