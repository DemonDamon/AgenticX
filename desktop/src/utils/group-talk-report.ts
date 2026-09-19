/**
 * Peel a short spoken lead from a long group-chat report.
 * Author: Damon Li
 */

const REPORT_MIN_CHARS = 480;
const REPORT_HEADING_MIN_CHARS = 560;
const REPORT_PLAIN_MIN_CHARS = 900;
const TALK_MAX_CHARS = 480;
const LEAD_BEFORE_HEADING_MIN = 20;
const REMAINDER_MIN_CHARS = 160;
const NEARLY_FULL_DELTA = 40;
const SENTENCE_BREAK_MIN = 80;

const HEADING_RE = /^#{1,3}\s+/m;
const TABLE_ROW_RE = /^\|.+\|$/gm;

export function looksLikeGroupReport(text: string): boolean {
  const raw = String(text ?? "").trim();
  if (raw.length < REPORT_MIN_CHARS) return false;
  if (HEADING_RE.test(raw) && raw.length >= REPORT_HEADING_MIN_CHARS) return true;
  if ((raw.match(TABLE_ROW_RE) ?? []).length >= 4) return true;
  return raw.length >= REPORT_PLAIN_MIN_CHARS;
}

export function extractTalkLead(text: string, maxChars = TALK_MAX_CHARS): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  const headingIdx = raw.search(HEADING_RE);
  if (headingIdx >= LEAD_BEFORE_HEADING_MIN) {
    return trimLead(raw.slice(0, headingIdx), maxChars);
  }
  return trimLead(raw, maxChars);
}

function trimLead(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, maxChars);
  const lastStop = Math.max(
    slice.lastIndexOf("。"),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("？"),
    slice.lastIndexOf("\n"),
    slice.lastIndexOf(". "),
  );
  if (lastStop >= SENTENCE_BREAK_MIN) {
    const end = slice[lastStop] === "." ? lastStop + 1 : lastStop + 1;
    return slice.slice(0, end).trim();
  }
  return slice.trim();
}

export function splitGroupTalkFromReport(text: string): { talk: string; report: string | null } {
  const raw = String(text ?? "").trim();
  if (!raw || !looksLikeGroupReport(raw)) {
    return { talk: raw, report: null };
  }
  const talk = extractTalkLead(raw, TALK_MAX_CHARS);
  if (!talk || raw.length - talk.length < NEARLY_FULL_DELTA) {
    return { talk: raw, report: null };
  }
  const report = raw.slice(talk.length).trim();
  if (report.length < REMAINDER_MIN_CHARS) {
    return { talk: raw, report: null };
  }
  return { talk, report };
}
