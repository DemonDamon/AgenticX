export const QUICK_START_IDS = [
  "summarize",
  "weekly",
  "minutes",
  "explainCode",
  "plan",
  "translate",
] as const;

export type QuickStartId = (typeof QUICK_START_IDS)[number];
