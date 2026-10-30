/**
 * Portal mirror of admin self-serve query ACL + forced masking (H5).
 * Keep fixture grants aligned with admin-console data-query-acl / Python sample_query_acl.
 */

type MaskStrategy = "full" | "partial" | "hash" | "drop";

const SAMPLE_MASKING_POLICY = {
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
  ],
};

export const SAMPLE_QUERY_ROWS: Array<Record<string, string>> = [
  { phone: "13812345678", email: "alice@example.com", region: "east", member_id: "M-001" },
];

export type QueryAclGrant = {
  role: string;
  datasets: string[];
  boards: string[];
  fields?: string[];
};

export type QueryAclPolicy = {
  id: string;
  defaultEffect: "deny" | "allow";
  grants: QueryAclGrant[];
};

export const SAMPLE_QUERY_ACL: QueryAclPolicy = {
  id: "sample_query_acl",
  defaultEffect: "deny",
  grants: [
    { role: "admin", datasets: ["*"], boards: ["*"] },
    {
      role: "analyst",
      datasets: ["members"],
      boards: ["sample_member_board", "golden_member_board"],
    },
    {
      role: "guest",
      datasets: ["members"],
      boards: ["sample_member_board", "golden_member_board"],
      fields: [
        "phone",
        "email",
        "region",
        "member_id",
        "tier",
        "status",
        "orders",
        "brand",
        "line",
        "config",
      ],
    },
  ],
};

export class QueryAccessDenied extends Error {
  readonly code = "query_acl_denied";
  constructor(readonly reason: string) {
    super(reason);
    this.name = "QueryAccessDenied";
  }
}

export type AccessDecision = { allowed: boolean; reason: string };

function matches(allowed: string[], value: string): boolean {
  return allowed.includes("*") || allowed.includes(value);
}

function partial(value: string): string {
  if (value.length <= 2) return "*".repeat(value.length);
  return value[0] + "*".repeat(value.length - 2) + value[value.length - 1];
}

function applyStrategy(value: string, strategy: MaskStrategy): string | null {
  if (strategy === "full") return value;
  if (strategy === "partial") return partial(value);
  if (strategy === "drop") return null;
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 12);
}

function maskRows(
  rows: Array<Record<string, string>>,
  role: string,
): Array<Record<string, string | null>> {
  return rows.map((row) => {
    const out: Record<string, string | null> = { ...row };
    for (const rule of SAMPLE_MASKING_POLICY.rules) {
      if (!(rule.field in out)) continue;
      const strategy = rule.strategies[role] ?? rule.defaultStrategy;
      out[rule.field] = applyStrategy(row[rule.field] ?? "", strategy);
    }
    return out;
  });
}

export function checkQueryAccess(
  policy: QueryAclPolicy,
  opts: { role: string; datasetId: string; boardId?: string | null; fields?: string[] | null },
): AccessDecision {
  const grant = policy.grants.find((g) => g.role === opts.role);
  if (!grant) {
    if (policy.defaultEffect === "allow") return { allowed: true, reason: "default_allow" };
    return { allowed: false, reason: `role_not_granted:${opts.role}` };
  }
  if (!matches(grant.datasets, opts.datasetId)) {
    return { allowed: false, reason: `dataset_denied:${opts.datasetId}` };
  }
  if (opts.boardId != null && opts.boardId !== "") {
    if (grant.boards.length > 0 && !matches(grant.boards, opts.boardId)) {
      return { allowed: false, reason: `board_denied:${opts.boardId}` };
    }
  }
  if (opts.fields && grant.fields) {
    for (const f of opts.fields) {
      if (!matches(grant.fields, f)) return { allowed: false, reason: `field_denied:${f}` };
    }
  }
  return { allowed: true, reason: "granted" };
}

export function secureQueryRows(
  rows: Array<Record<string, string>>,
  opts: {
    role: string;
    datasetId: string;
    boardId?: string | null;
    fields?: string[] | null;
    acl?: QueryAclPolicy;
  },
): Array<Record<string, string | null>> {
  const acl = opts.acl ?? SAMPLE_QUERY_ACL;
  const decision = checkQueryAccess(acl, {
    role: opts.role,
    datasetId: opts.datasetId,
    boardId: opts.boardId,
    fields: opts.fields,
  });
  if (!decision.allowed) throw new QueryAccessDenied(decision.reason);
  return maskRows(rows, opts.role);
}
