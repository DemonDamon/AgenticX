import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

import { maError } from "./errors";

let cached: string | undefined;

/** MA_INTERNAL_TOKEN 优先，其次读 MA_INTERNAL_TOKEN_FILE。结果进程内缓存。 */
export function getMaInternalToken(): string {
  if (cached !== undefined) return cached;

  const direct = process.env.MA_INTERNAL_TOKEN?.trim();
  if (direct) {
    cached = direct;
    return direct;
  }

  const file = process.env.MA_INTERNAL_TOKEN_FILE?.trim();
  if (file) {
    try {
      const fromFile = readFileSync(file, "utf-8").trim();
      if (fromFile) {
        cached = fromFile;
        return fromFile;
      }
    } catch {
      // fall through
    }
  }

  cached = "";
  return "";
}

/** 测试用：清缓存。 */
export function __resetMaInternalTokenCacheForTests(): void {
  cached = undefined;
}

/** 未配置 → false。长度不等 → false。否则 timingSafeEqual。 */
export function isMaInternalAuthorized(request: Request): boolean {
  const expected = getMaInternalToken();
  if (!expected) return false;
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([\s\S]+)$/i.exec(auth);
  const token = match?.[1]?.trim();
  if (!token) return false;
  const actualBytes = Buffer.from(token);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

/** 401：{"error":{"code":"unauthorized","message":"invalid internal token"}} */
export function maInternalUnauthorized() {
  return maError("unauthorized", "invalid internal token");
}
