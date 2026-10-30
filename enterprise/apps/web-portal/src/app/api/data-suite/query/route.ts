import { NextResponse } from "next/server";
import {
  QueryAccessDenied,
  SAMPLE_QUERY_ROWS,
  secureQueryRows,
} from "../../../../lib/data-query-acl";
import { getSessionFromCookies } from "../../../../lib/session";

type QueryBody = {
  role?: string;
  dataset_id?: string;
  board_id?: string;
  fields?: string[];
};

/** Minimal portal self-serve query entry (H5): session + ACL + forced mask. */
export async function POST(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json({ code: "40101", message: "unauthorized" }, { status: 401 });
  }

  let body: QueryBody;
  try {
    body = (await request.json()) as QueryBody;
  } catch {
    return NextResponse.json({ code: "40000", message: "无效请求体" }, { status: 400 });
  }

  const role = body.role?.trim();
  const datasetId = body.dataset_id?.trim();
  if (!role || !datasetId) {
    return NextResponse.json(
      { code: "40000", message: "role 与 dataset_id 必填" },
      { status: 400 },
    );
  }

  try {
    const rows = secureQueryRows(SAMPLE_QUERY_ROWS, {
      role,
      datasetId,
      boardId: body.board_id?.trim() || null,
      fields: body.fields,
    });
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { rows, dataset_id: datasetId, role, masked: true },
    });
  } catch (error) {
    if (error instanceof QueryAccessDenied) {
      return NextResponse.json(
        { code: "40310", message: "数据权限不足", reason: error.reason },
        { status: 403 },
      );
    }
    const message = error instanceof Error ? error.message : "取数失败";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
