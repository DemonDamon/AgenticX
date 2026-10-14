import type { CollabRoomMember } from "./types";

const MAX_MENTIONS = 3;

/** 与 mentionsMeta 的前导集合一致：行首，或空白 / 中英文标点。 */
const LEAD_RE = /[\s，,。.:：;；!！?？(（]/;
const TRAIL_RE = /[\s，,。.:：;；!！?？(（)）、"'“”‘’]/;

function isLead(content: string, at: number): boolean {
  if (at <= 0) return true;
  const prev = content[at - 1];
  return prev != null && LEAD_RE.test(prev);
}

function isTrail(content: string, end: number): boolean {
  if (end >= content.length) return true;
  const next = content[end];
  return next != null && TRAIL_RE.test(next);
}

function mentionIndex(content: string, name: string): number {
  const needle = name.trim();
  if (!needle) return -1;
  const foldedNeedle = needle.toLowerCase();
  const caseFold = foldedNeedle.length === needle.length;
  const haystack = caseFold ? content.toLowerCase() : content;
  const target = caseFold ? foldedNeedle : needle;
  let from = 0;
  while (from < content.length) {
    const at = content.indexOf("@", from);
    if (at < 0) return -1;
    const start = at + 1;
    if (
      isLead(content, at) &&
      haystack.slice(start, start + target.length) === target &&
      isTrail(content, start + target.length)
    ) {
      return at;
    }
    from = at + 1;
  }
  return -1;
}

/**
 * 在正文里找出被点名的在房智能体。
 * slug 不在成员行上，由调用方用 slugById 传入。@meta 不在这里处理。
 */
export function findMentionedAgents(
  content: string,
  members: CollabRoomMember[],
  slugById?: Map<string, string>,
): CollabRoomMember[] {
  const hits: Array<{ index: number; order: number; member: CollabRoomMember }> = [];
  members.forEach((member, order) => {
    if (member.member_type !== "agent" || member.left_at) return;
    const names = [member.display_name];
    const slug = slugById?.get(member.member_id);
    if (slug && slug !== member.display_name) names.push(slug);
    let earliest = -1;
    for (const name of names) {
      const index = mentionIndex(content, name);
      if (index >= 0 && (earliest < 0 || index < earliest)) earliest = index;
    }
    if (earliest >= 0) hits.push({ index: earliest, order, member });
  });
  hits.sort((left, right) => left.index - right.index || left.order - right.order);
  const seen = new Set<string>();
  const result: CollabRoomMember[] = [];
  for (const hit of hits) {
    if (seen.has(hit.member.member_id)) continue;
    seen.add(hit.member.member_id);
    result.push(hit.member);
    if (result.length >= MAX_MENTIONS) break;
  }
  return result;
}
