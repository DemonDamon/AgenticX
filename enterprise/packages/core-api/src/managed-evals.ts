import { createHash } from "crypto";

import { canonicalJson } from "./managed-agents";

export const RULE_TYPES = [
  "contains",
  "not_contains",
  "regex",
  "tool_called",
  "tool_not_called",
  "max_tool_calls",
  "stop_reason",
] as const;

export const JUDGE_MODES = ["binary", "score"] as const;

export const STOP_REASON_VALUES = [
  "end_turn",
  "requires_action",
  "retries_exhausted",
  "refusal",
  "max_tool_rounds",
  "budget_exceeded",
  "policy_blocked",
] as const;

export const MAX_CRITERIA_BYTES = 32768;
export const MAX_RULE_CHECKS = 20;
export const MAX_RULE_VALUE_BYTES = 1000;
export const MAX_RULE_PATTERN_BYTES = 500;
export const DEFAULT_PASS_THRESHOLD = 0.7;

const RULE_TYPE_LIST = `[${RULE_TYPES.join(",")}]`;
const STOP_LIST = `[${STOP_REASON_VALUES.join(",")}]`;
const ALLOWED_KEYS = ["criteria", "mode", "pass_threshold", "judge_model", "rule_checks"] as const;
const MODEL_RE = /^[^/\s]+\/\S+$/;

const RULE_FIELDS: Record<(typeof RULE_TYPES)[number], readonly string[]> = {
  contains: ["type", "value", "case_sensitive"],
  not_contains: ["type", "value", "case_sensitive"],
  regex: ["type", "pattern"],
  tool_called: ["type", "name"],
  tool_not_called: ["type", "name"],
  max_tool_calls: ["type", "value"],
  stop_reason: ["type", "value"],
};

export type EvalRuleCheck =
  | { type: "contains" | "not_contains"; value: string; case_sensitive: boolean }
  | { type: "regex"; pattern: string }
  | { type: "tool_called" | "tool_not_called"; name: string }
  | { type: "max_tool_calls"; value: number }
  | { type: "stop_reason"; value: (typeof STOP_REASON_VALUES)[number] };

export type EvalRubric = {
  criteria: string;
  mode: (typeof JUDGE_MODES)[number];
  pass_threshold: number;
  judge_model: string | null;
  rule_checks: EvalRuleCheck[];
};

export type RubricResult = {
  ok: boolean;
  errors: string[];
  normalized: EvalRubric | null;
  contentHash: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function failure(errors: string[]): RubricResult {
  return { ok: false, errors: [...errors].sort(), normalized: null, contentHash: null };
}

function contentHash(normalized: EvalRubric): string {
  return `sha256:${createHash("sha256").update(canonicalJson(normalized), "utf8").digest("hex")}`;
}

function isRuleType(value: unknown): value is (typeof RULE_TYPES)[number] {
  return typeof value === "string" && (RULE_TYPES as readonly string[]).includes(value);
}

function checkRule(index: number, item: unknown, errors: string[]): EvalRuleCheck | null {
  const prefix = `rubric.rule_checks[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${prefix}: must be an object`);
    return null;
  }
  const rawType = "type" in item ? item.type : null;
  if (!isRuleType(rawType)) {
    errors.push(`${prefix}.type: must be one of ${RULE_TYPE_LIST}, got ${JSON.stringify(rawType)}`);
    return null;
  }
  const allowed = new Set(RULE_FIELDS[rawType]);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) errors.push(`${prefix}.${key}: unknown field`);
  }
  switch (rawType) {
    case "contains":
    case "not_contains": {
      const value = item.value;
      if (typeof value !== "string" || value.length === 0 || utf8Length(value) > MAX_RULE_VALUE_BYTES) {
        errors.push(`${prefix}.value: must be a non-empty string of at most ${MAX_RULE_VALUE_BYTES} bytes`);
        return null;
      }
      if ("case_sensitive" in item && typeof item.case_sensitive !== "boolean") {
        errors.push(`${prefix}.case_sensitive: must be a boolean`);
        return null;
      }
      const caseSensitive = typeof item.case_sensitive === "boolean" ? item.case_sensitive : false;
      return { type: rawType, value, case_sensitive: caseSensitive };
    }
    case "regex": {
      const pattern = item.pattern;
      if (typeof pattern !== "string" || pattern.length === 0 || utf8Length(pattern) > MAX_RULE_PATTERN_BYTES) {
        errors.push(`${prefix}.pattern: must be a non-empty string of at most ${MAX_RULE_PATTERN_BYTES} bytes`);
        return null;
      }
      return { type: "regex", pattern };
    }
    case "tool_called":
    case "tool_not_called": {
      const name = item.name;
      if (typeof name !== "string" || name.length === 0) {
        errors.push(`${prefix}.name: is required`);
        return null;
      }
      return { type: rawType, name };
    }
    case "max_tool_calls": {
      const value = item.value;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1000) {
        errors.push(`${prefix}.value: must be an integer between 0 and 1000`);
        return null;
      }
      return { type: "max_tool_calls", value };
    }
    case "stop_reason": {
      const value = item.value;
      if (typeof value !== "string" || !(STOP_REASON_VALUES as readonly string[]).includes(value)) {
        errors.push(`${prefix}.value: must be one of ${STOP_LIST}`);
        return null;
      }
      return { type: "stop_reason", value: value as (typeof STOP_REASON_VALUES)[number] };
    }
    default: {
      const unreachable: never = rawType;
      errors.push(`${prefix}.type: must be one of ${RULE_TYPE_LIST}, got ${JSON.stringify(unreachable)}`);
      return null;
    }
  }
}

export function validateRubric(raw: unknown): RubricResult {
  if (!isRecord(raw)) return failure(["rubric: must be a JSON object"]);
  const errors: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!(ALLOWED_KEYS as readonly string[]).includes(key)) errors.push(`rubric.${key}: unknown field`);
  }

  let criteriaOk = true;
  let criteria = "";
  if ("criteria" in raw) {
    if (typeof raw.criteria !== "string") {
      errors.push("rubric.criteria: must be a string");
      criteriaOk = false;
    } else {
      criteria = raw.criteria;
      if (utf8Length(criteria) > MAX_CRITERIA_BYTES) {
        errors.push(`rubric.criteria: exceeds ${MAX_CRITERIA_BYTES} bytes`);
      }
    }
  }

  let mode: EvalRubric["mode"] = "binary";
  if ("mode" in raw) {
    if (raw.mode !== "binary" && raw.mode !== "score") {
      errors.push("rubric.mode: must be one of [binary,score]");
    } else {
      mode = raw.mode;
    }
  }

  let passThreshold = DEFAULT_PASS_THRESHOLD;
  if ("pass_threshold" in raw) {
    const value = raw.pass_threshold;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      errors.push("rubric.pass_threshold: must be a number between 0 and 1");
    } else {
      passThreshold = value;
    }
  }

  let judgeModel: string | null = null;
  if ("judge_model" in raw && raw.judge_model !== null) {
    const model = raw.judge_model;
    if (typeof model !== "string" || !MODEL_RE.test(model)) {
      errors.push('rubric.judge_model: must be null or "<providerId>/<modelName>"');
    } else {
      judgeModel = model;
      if (criteriaOk && criteria === "") errors.push("rubric.criteria: is required when judge_model is set");
    }
  }

  const normalizedRules: EvalRuleCheck[] = [];
  if ("rule_checks" in raw) {
    const checks = raw.rule_checks;
    if (!Array.isArray(checks)) {
      errors.push("rubric.rule_checks: must be an array");
    } else if (checks.length > MAX_RULE_CHECKS) {
      errors.push(`rubric.rule_checks: must contain at most ${MAX_RULE_CHECKS} items`);
    } else {
      checks.forEach((item, index) => {
        const normalized = checkRule(index, item, errors);
        if (normalized) normalizedRules.push(normalized);
      });
    }
  }

  if (errors.length === 0 && judgeModel === null && normalizedRules.length === 0) {
    errors.push("rubric: must define judge_model or at least one rule check");
  }
  if (errors.length > 0) return failure(errors);
  const normalized: EvalRubric = {
    criteria,
    mode,
    pass_threshold: passThreshold,
    judge_model: judgeModel,
    rule_checks: normalizedRules,
  };
  return { ok: true, errors: [], normalized, contentHash: contentHash(normalized) };
}
