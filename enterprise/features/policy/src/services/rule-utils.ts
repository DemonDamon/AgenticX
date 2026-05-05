import type { PolicyAppliesTo, PolicyRulePayload, PolicyStage, UpsertPolicyRuleInput } from "../types";
import { DEFAULT_POLICY_APPLIES_TO } from "../types";

const PII_PATTERNS: Record<string, RegExp> = {
  mobile: /(?:(?:\+?86)?1[3-9]\d{9})/g,
  email: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
  "id-card": /\b\d{17}[\dXx]\b/g,
  "bank-card": /\b\d{16,19}\b/g,
  "api-key": /\b(?:sk|ak|pk|token)[-_]?[a-z0-9]{16,}\b/gi,
};

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

export function normalizeAppliesTo(input?: Partial<PolicyAppliesTo> | null): PolicyAppliesTo {
  const src = input ?? {};
  return {
    version: 1,
    departmentIds: uniq(src.departmentIds ?? DEFAULT_POLICY_APPLIES_TO.departmentIds),
    departmentRecursive: src.departmentRecursive ?? DEFAULT_POLICY_APPLIES_TO.departmentRecursive,
    roleCodes: uniq(src.roleCodes ?? DEFAULT_POLICY_APPLIES_TO.roleCodes),
    userIds: uniq(src.userIds ?? DEFAULT_POLICY_APPLIES_TO.userIds),
    userExcludeIds: uniq(src.userExcludeIds ?? DEFAULT_POLICY_APPLIES_TO.userExcludeIds),
    clientTypes: uniq(src.clientTypes ?? DEFAULT_POLICY_APPLIES_TO.clientTypes),
    stages: (src.stages?.filter((s): s is PolicyStage => s === "request" || s === "response") ??
      DEFAULT_POLICY_APPLIES_TO.stages) as PolicyStage[],
  };
}

export function normalizeRulePayload(
  kind: UpsertPolicyRuleInput["kind"],
  payload: PolicyRulePayload
): PolicyRulePayload {
  if (kind === "keyword") {
    const keywords = uniq(payload.keywords ?? []);
    if (!keywords.length) throw new Error("关键词规则至少需要一个关键词");
    return { keywords };
  }
  if (kind === "regex") {
    const pattern = payload.pattern?.trim();
    if (!pattern) throw new Error("正则规则缺少 pattern");
    return { pattern };
  }
  const piiType = payload.piiType?.trim();
  if (!piiType) throw new Error("PII 规则缺少 piiType");
  return { piiType };
}

function normalizeRegex(pattern: string): { source: string; flags: string } {
  if (pattern.startsWith("(?i)")) {
    return { source: pattern.slice(4), flags: "gi" };
  }
  return { source: pattern, flags: "g" };
}

export function findRuleMatches(
  kind: UpsertPolicyRuleInput["kind"],
  payload: PolicyRulePayload,
  text: string
): string[] {
  if (kind === "keyword") {
    const out: string[] = [];
    for (const keyword of payload.keywords ?? []) {
      if (keyword && text.includes(keyword)) out.push(keyword);
    }
    return out;
  }
  if (kind === "regex") {
    const pattern = payload.pattern ?? "";
    if (!pattern) return [];
    const { source, flags } = normalizeRegex(pattern);
    const re = new RegExp(source, flags);
    return Array.from(text.matchAll(re)).map((m) => m[0]).filter(Boolean);
  }
  const piiType = (payload.piiType ?? "").toLowerCase();
  const re = PII_PATTERNS[piiType];
  if (!re) return [];
  return Array.from(text.matchAll(re)).map((m) => m[0]).filter(Boolean);
}
