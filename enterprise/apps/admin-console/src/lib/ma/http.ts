export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const TENANT_ID_RE = /^[0-9A-Za-z_-]{1,64}$/;

export class MaRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaRequestError";
  }
}

/** 请求体必须是 JSON object。 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new MaRequestError("request body must be a JSON object");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MaRequestError("request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/** 出现 allowed 之外的键时，按键名字典序报第一个。 */
export function assertOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(body)
    .filter((key) => !allowedSet.has(key))
    .sort();
  if (unknown[0]) throw new MaRequestError(`unknown field: ${unknown[0]}`);
}

/** "latest" | "effective" | 正整数（字符串形式）。 */
export function parseVersionParam(raw: string): "latest" | "effective" | number {
  if (raw === "latest" || raw === "effective") return raw;
  if (/^[1-9]\d{0,8}$/.test(raw)) return Number(raw);
  throw new MaRequestError("invalid version");
}
