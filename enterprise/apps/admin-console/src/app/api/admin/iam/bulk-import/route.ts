import { hashPassword } from "@agenticx/auth";
import {
  findOrCreateDepartmentPath,
  getDefaultOrgId,
  getIamDb,
  upsertUserByEmailInTx,
} from "@agenticx/iam-core";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminScope } from "../../../../../lib/admin-auth";

const MAX_ROWS = 5000;

type BulkRow = {
  email: string;
  displayName: string;
  deptPath?: string;
  roleCodes?: string[];
  phone?: string | null;
  employeeNo?: string | null;
  jobTitle?: string | null;
  status?: "active" | "disabled";
  initialPassword?: string | null;
};

export type BulkImportFailure = {
  index: number;
  email: string;
  reason: string;
  displayName?: string;
  deptPath?: string;
  roleCodes?: string;
  phone?: string;
  employeeNo?: string;
  jobTitle?: string;
  status?: string;
};

function genPw(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  const buf = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[buf[i]! % chars.length];
  return out;
}

function rowSnapshot(row: BulkRow): Pick<
  BulkImportFailure,
  "displayName" | "deptPath" | "roleCodes" | "phone" | "employeeNo" | "jobTitle" | "status"
> {
  return {
    displayName: typeof row.displayName === "string" ? row.displayName : "",
    deptPath: row.deptPath?.trim() || "",
    roleCodes: row.roleCodes?.length ? row.roleCodes.join(";") : "",
    phone: row.phone ?? "",
    employeeNo: row.employeeNo ?? "",
    jobTitle: row.jobTitle ?? "",
    status: row.status ?? "",
  };
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["user:create"]);
  if (!auth.ok) return auth.response;

  const orgId = await getDefaultOrgId(auth.session.tenantId);
  if (!orgId) {
    return NextResponse.json({ code: "40000", message: "no organization for tenant" }, { status: 400 });
  }

  let body: { rows?: BulkRow[] };
  try {
    body = (await request.json()) as { rows?: BulkRow[] };
  } catch {
    return NextResponse.json({ code: "40001", message: "invalid json" }, { status: 400 });
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) {
    return NextResponse.json({ code: "40000", message: "rows required" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { code: "40000", message: `rows exceed limit (${MAX_ROWS})` },
      { status: 400 }
    );
  }

  const failures: BulkImportFailure[] = [];
  let success = 0;
  const db = getIamDb();

  for (let globalIndex = 0; globalIndex < rows.length; globalIndex++) {
    const row = rows[globalIndex]!;
    const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
    const displayName = typeof row.displayName === "string" ? row.displayName.trim() : "";
    const snap = rowSnapshot(row);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !displayName) {
      failures.push({
        index: globalIndex,
        email,
        reason: "invalid email or displayName",
        ...snap,
      });
      continue;
    }

    try {
      await db.transaction(async (tx) => {
        let deptId: string | null = null;
        if (row.deptPath?.trim()) {
          const { leafDeptId } = await findOrCreateDepartmentPath({
            tenantId: auth.session.tenantId,
            orgId,
            path: row.deptPath.trim(),
            actorUserId: auth.session.userId,
            tx,
          });
          deptId = leafDeptId;
        }
        const plain = row.initialPassword?.trim() || genPw();
        const passwordHash = await hashPassword(plain);
        const roleCodes = row.roleCodes?.length ? row.roleCodes : ["member"];
        await upsertUserByEmailInTx(tx, {
          tenantId: auth.session.tenantId,
          email,
          displayName,
          deptId,
          phone: row.phone ?? null,
          employeeNo: row.employeeNo ?? null,
          jobTitle: row.jobTitle ?? null,
          passwordHash,
          status: row.status,
          roleCodes,
          defaultOrgId: orgId,
          actorUserId: auth.session.userId,
        });
      });
      success += 1;
    } catch (e) {
      failures.push({
        index: globalIndex,
        email,
        reason: e instanceof Error ? e.message : "import error",
        ...snap,
      });
    }
  }

  return NextResponse.json({
    code: failures.length ? "40002" : "00000",
    message: failures.length ? "partial failure" : "ok",
    data: { success, failed: failures.length, failures },
  });
}
