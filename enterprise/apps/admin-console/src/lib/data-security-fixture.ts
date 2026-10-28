export type MaskStrategy = "full" | "partial" | "hash" | "drop";

export type FieldMaskRule = {
  field: string;
  sensitivity: string;
  defaultStrategy: MaskStrategy;
  strategies: Record<string, MaskStrategy>;
};

export const SAMPLE_MASKING_POLICY = {
  id: "sample_masking",
  rules: [
    {
      field: "phone",
      sensitivity: "confidential",
      defaultStrategy: "drop" as MaskStrategy,
      strategies: { admin: "full", analyst: "partial", guest: "drop" } as Record<string, MaskStrategy>,
    },
    {
      field: "email",
      sensitivity: "internal",
      defaultStrategy: "partial" as MaskStrategy,
      strategies: { admin: "full", analyst: "partial" } as Record<string, MaskStrategy>,
    },
  ] satisfies FieldMaskRule[],
};

export const SAMPLE_SECURITY_ROWS = [
  { phone: "13812345678", email: "alice@example.com", region: "east" },
];

function partial(value: string): string {
  if (value.length <= 2) return "*".repeat(value.length);
  return value[0] + "*".repeat(value.length - 2) + value[value.length - 1];
}

function applyStrategy(value: string, strategy: MaskStrategy): string | null {
  if (strategy === "full") return value;
  if (strategy === "partial") return partial(value);
  if (strategy === "drop") return null;
  // hash: stable-ish for fixture preview (not crypto; UI demo only)
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 12);
}

export function maskRows(
  rows: Array<Record<string, string>>,
  role: string,
  policy = SAMPLE_MASKING_POLICY,
): Array<Record<string, string | null>> {
  return rows.map((row) => {
    const out: Record<string, string | null> = { ...row };
    for (const rule of policy.rules) {
      if (!(rule.field in out)) continue;
      const strategy = rule.strategies[role] ?? rule.defaultStrategy;
      const raw = row[rule.field] ?? "";
      out[rule.field] = applyStrategy(raw, strategy);
    }
    return out;
  });
}
