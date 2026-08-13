/**
 * Ranked skill picker / settings search.
 *
 * Naive `includes()` on the description matches mid-word fragments such as
 * "arch" inside "research". Prefer name prefix / token prefix, and only allow
 * Latin description hits when a token starts with the query.
 */

const CJK_RE = /[\u4e00-\u9fff]/;
const TOKEN_SPLIT_RE = /[^a-z0-9\u4e00-\u9fff]+/;

const SCORE_NAME_EXACT = 1000;
const SCORE_NAME_PREFIX = 900;
const SCORE_NAME_TOKEN_PREFIX = 800;
const SCORE_NAME_INFIX = 600;
const SCORE_DESC_TOKEN_PREFIX = 400;
const SCORE_DESC_CJK = 350;

/** Short Latin queries must be token prefixes; longer ones may infixes in names. */
const MIN_NAME_INFIX_QUERY_LEN = 5;

export type SkillSearchable = {
  name: string;
  description?: string | null;
};

export function tokenizeSkillText(text: string): string[] {
  return text
    .toLowerCase()
    .split(TOKEN_SPLIT_RE)
    .filter(Boolean);
}

export function skillSearchScore(
  name: string,
  description: string | null | undefined,
  query: string,
): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const n = name.toLowerCase();
  const d = (description ?? "").toLowerCase();
  const queryHasCjk = CJK_RE.test(q);

  if (n === q) return SCORE_NAME_EXACT;
  if (n.startsWith(q)) return SCORE_NAME_PREFIX;

  const nameTokens = tokenizeSkillText(n);
  if (nameTokens.some((token) => token.startsWith(q))) return SCORE_NAME_TOKEN_PREFIX;

  const allowNameInfix = !queryHasCjk && q.length >= MIN_NAME_INFIX_QUERY_LEN;
  if (allowNameInfix && nameTokens.some((token) => token.includes(q))) return SCORE_NAME_INFIX;
  if (queryHasCjk && n.includes(q)) return SCORE_NAME_INFIX;

  const descTokens = tokenizeSkillText(d);
  if (descTokens.some((token) => token.startsWith(q))) return SCORE_DESC_TOKEN_PREFIX;
  if (queryHasCjk && d.includes(q)) return SCORE_DESC_CJK;

  return null;
}

export function filterAndRankSkills<T extends SkillSearchable>(skills: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return skills;

  return skills
    .map((skill, index) => ({
      skill,
      index,
      score: skillSearchScore(skill.name, skill.description, q),
    }))
    .filter((row): row is { skill: T; index: number; score: number } => row.score != null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.skill);
}
