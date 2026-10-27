import { NextResponse } from "next/server";
import { touchPatLastUsed, verifyPat } from "@agenticx/iam-core";

import { maError } from "./errors";

export type MaPatIdentity = {
  tokenId: number;
  tenantId: string;
  userId: string;
  deptId: string | null;
  scopes: string[];
};

export function patHasMaScope(scopes: readonly string[], required: string): boolean {
  return scopes.includes(required) || scopes.includes("ma:admin");
}

function unauthorized(): NextResponse {
  return maError("unauthorized", "missing or invalid token");
}

/**
 * Bearer PAT 鉴权。成功时异步 touchPatLastUsed，失败不影响本次请求。
 */
export async function requireMaPat(
  request: Request,
  required: string,
): Promise<{ ok: true; identity: MaPatIdentity } | { ok: false; response: NextResponse }> {
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([\s\S]+)$/i.exec(auth);
  const token = match?.[1]?.trim() ?? "";
  if (!token.startsWith("agx-pat-")) return { ok: false, response: unauthorized() };

  const verified = await verifyPat(token);
  if (!verified) return { ok: false, response: unauthorized() };
  if (!patHasMaScope(verified.scopes, required)) {
    return {
      ok: false,
      response: maError("forbidden_scope", "token lacks required scope", { required }),
    };
  }
  void Promise.resolve(touchPatLastUsed(verified.id)).catch(() => {});
  return {
    ok: true,
    identity: {
      tokenId: verified.id,
      tenantId: verified.tenantId,
      userId: verified.userId,
      deptId: verified.deptId,
      scopes: verified.scopes,
    },
  };
}
