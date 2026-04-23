export type MeteringGroupKey = "dept" | "user" | "provider" | "model" | "day";

export type MeteringQueryInput = {
  tenant_id: string;
  dept_id?: string[];
  user_id?: string[];
  provider?: string[];
  model?: string[];
  start: string;
  end: string;
  group_by: MeteringGroupKey[];
};

export type MeteringPivotRow = {
  dims: Record<string, string | null>;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
};

export type MeteringQueryResult = {
  rows: MeteringPivotRow[];
};

