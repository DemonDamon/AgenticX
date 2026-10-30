import { SAMPLE_BOARD, type BoardSpec } from "./data-board-fixture";

export type DictionaryField = {
  name: string;
  business_def: string;
  calc_logic: string;
  update_freq: string;
  owner: string;
};

/** Seed fields mirrored from data-governance SAMPLE_FIELDS / sample_dictionary.yaml. */
export const SAMPLE_DICTIONARY_FIELDS: DictionaryField[] = [
  {
    name: "member_id",
    business_def: "Stable member primary key after OneID merge",
    calc_logic: "idmapping.merge primary",
    update_freq: "daily",
    owner: "data-platform",
  },
  {
    name: "mobile_hash",
    business_def: "Hashed mobile used as ID edge",
    calc_logic: "sha256(mobile_e164)",
    update_freq: "daily",
    owner: "data-platform",
  },
];

export type { BoardSpec };
export { SAMPLE_BOARD };

export type CleaningRule = {
  id: string;
  template: string;
  field: string;
  params: Record<string, unknown>;
  enabled: boolean;
};

export type ClassificationGrade = {
  id: string;
  label: string;
  rank: number;
};

export type QualityMetric = {
  id: string;
  type: string;
  field: string;
};

export type QualityLastRun = {
  day: string;
  metrics: Record<string, number>;
  meta: Record<string, unknown>;
};

export type ReviewAction = {
  id: string;
  target_rule_id: string;
  decision: "approve" | "reject" | "keep";
  note: string;
  at: string;
};

/** Generic grade seed (names configurable; not business content). */
export const SAMPLE_CLASSIFICATION_GRADES: ClassificationGrade[] = [
  { id: "S", label: "S", rank: 4 },
  { id: "A", label: "A", rank: 3 },
  { id: "B", label: "B", rank: 2 },
  { id: "C", label: "C", rank: 1 },
];

/** Minimal generic cleaning rule sample (no customer fields). */
export const SAMPLE_CLEANING_RULES: CleaningRule[] = [
  {
    id: "sample_not_null",
    template: "not_null",
    field: "id",
    params: {},
    enabled: true,
  },
];

/** Minimal generic quality metric sample. */
export const SAMPLE_QUALITY_METRICS: QualityMetric[] = [
  { id: "sample_null_rate", type: "null_rate", field: "id" },
];

