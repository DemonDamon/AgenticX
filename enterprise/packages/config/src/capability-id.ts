/**
 * 能力 id 的唯一构造与解析入口：`mcp:<ulid>` / `skill:<ulid>`。
 *
 * 用不可变的 ULID 而不是 name/slug，因为后者是管理员起的可变标签：改一次名，
 * 分配记录、用户关闭偏好、用量与审计就会全部指空，用量归属错乱对按能力计费
 * 尤其致命。前缀用来判断该去哪张表查（enterprise_skills / mcp_servers）。
 *
 * 各处手拼字符串迟早会拼出 `mcp:` 与 `mcp/` 两种写法，所以只留这一个入口。
 */

export const CAPABILITY_KINDS = ["mcp", "skill"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export type ParsedCapabilityId = {
  kind: CapabilityKind;
  /** 被引用行的主键（ULID）。 */
  rowId: string;
};

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isCapabilityKind(value: unknown): value is CapabilityKind {
  return typeof value === "string" && (CAPABILITY_KINDS as readonly string[]).includes(value);
}

/** ULID 的规范形态是大写 Crockford base32；小写输入统一抬成大写。 */
export function normalizeRowId(rowId: string): string {
  return String(rowId ?? "").trim().toUpperCase();
}

export function formatCapabilityId(kind: CapabilityKind, rowId: string): string {
  const normalized = normalizeRowId(rowId);
  if (!isCapabilityKind(kind)) throw new Error(`unknown capability kind: ${String(kind)}`);
  if (!ULID_RE.test(normalized)) throw new Error(`capability id requires a ULID, got: ${rowId}`);
  return `${kind}:${normalized}`;
}

/** 解析失败返回 null——脏数据不应该冒充一个能力。 */
export function parseCapabilityId(capabilityId: string): ParsedCapabilityId | null {
  const raw = String(capabilityId ?? "").trim();
  const separator = raw.indexOf(":");
  if (separator <= 0) return null;
  const kind = raw.slice(0, separator);
  const rowId = normalizeRowId(raw.slice(separator + 1));
  if (!isCapabilityKind(kind) || !ULID_RE.test(rowId)) return null;
  return { kind, rowId };
}

export function isCapabilityId(value: unknown): value is string {
  return typeof value === "string" && parseCapabilityId(value) !== null;
}

/** 按类型分组，便于一次性去各自的表里批量取行。 */
export function groupCapabilityIdsByKind(
  capabilityIds: readonly string[],
): Record<CapabilityKind, string[]> {
  const out: Record<CapabilityKind, string[]> = { mcp: [], skill: [] };
  for (const id of capabilityIds) {
    const parsed = parseCapabilityId(id);
    if (!parsed) continue;
    if (!out[parsed.kind].includes(parsed.rowId)) out[parsed.kind].push(parsed.rowId);
  }
  return out;
}
