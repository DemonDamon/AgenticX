export type MeteringGroupKey = "dept" | "user" | "provider" | "model" | "day" | "pat";

export type MeteringQueryInput = {
  tenant_id: string;
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
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
  cached_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
};

export type MeteringQueryResult = {
  rows: MeteringPivotRow[];
};

