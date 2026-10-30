import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";
import {
  QueryAccessDenied,
  SAMPLE_QUERY_ROWS,
  secureQueryRows,
} from "../../../../../lib/data-query-acl";

type QueryBody = {
  role?: string;
  dataset_id?: string;
  board_id?: string;
  fields?: string[];
};

/**
 * Self-serve query (H5): session auth + data-plane ACL + forced masking.
 * Body.role is the data role (admin/analyst/guest/…), not IAM scope.
 */
export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;

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
        {
          code: "40310",
          message: "数据权限不足",
          reason: error.reason,
        },
        { status: 403 },
      );
    }
    const message = error instanceof Error ? error.message : "取数失败";
    return NextResponse.json({ code: "50000", message }, { status: 500 });
  }
}
