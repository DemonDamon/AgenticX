import { NextResponse } from "next/server";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  fetchMcpDetail,
  searchMcpMarketplace,
  searchSkillHub,
  UpstreamUnreachableError,
} from "../../../../../lib/registry/upstream";

/**
 * 搜索外部市场，供管理员挑选后登记进本企业注册表。
 *
 * 服务端代发而不是让浏览器直连：这两个上游没有 CORS，而且 ModelScope 的 token（如果配了）
 * 不该出现在前端。这里只读不写，拿回来的东西要管理员确认后才进注册表。
 */
export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const source = url.searchParams.get("source") ?? "skill";
  const query = url.searchParams.get("q") ?? "";

  const detailId = url.searchParams.get("id");

  try {
    if (source === "mcp" && detailId) {
      // 详情单独一次请求：列表里没有连接信息，而一次把 9973 个服务的详情都拉回来
      // 既慢又没人看。管理员点了哪个才去取哪个。
      const detail = await fetchMcpDetail(detailId);
      return NextResponse.json({ code: "00000", message: "ok", data: { source, detail } });
    }
    if (source === "mcp") {
      const { items, total } = await searchMcpMarketplace(query);
      return NextResponse.json({ code: "00000", message: "ok", data: { source, items, total } });
    }
    const items = await searchSkillHub(query);
    return NextResponse.json({ code: "00000", message: "ok", data: { source: "skill", items, total: items.length } });
  } catch (error) {
    if (error instanceof UpstreamUnreachableError) {
      // 单独一个错误码：界面据此说「连不上市场，请手工登记」，而不是显示成搜不到结果。
      return NextResponse.json(
        { code: "50301", message: `${error.message}。若本机无法出网，请改用手工登记。` },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { code: "50000", message: error instanceof Error ? error.message : "搜索失败" },
      { status: 500 },
    );
  }
}
