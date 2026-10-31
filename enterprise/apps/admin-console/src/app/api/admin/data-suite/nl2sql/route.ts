import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  denialReasonZh,
  runAdminNl2Sql,
  type Nl2SqlAdminResult,
} from "../../../../../lib/nl2sql-admin";

type Body = {
  question?: string;
  mode?: string;
  sql?: string;
};

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ code: "40000", message: "无效请求体" }, { status: 400 });
  }

  const question = body.question?.trim() || "";
  if (!question && !(body.sql || "").trim()) {
    return NextResponse.json({ code: "40000", message: "question 必填" }, { status: 400 });
  }

  try {
    const result: Nl2SqlAdminResult = await runAdminNl2Sql({
      question,
      mode: body.mode,
      sql: body.sql,
    });
    const denial_zh =
      result.refused ? denialReasonZh(result.code, result.reason) : null;
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { ...result, denial_zh },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "问数失败";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
