/**
 * Self-serve query ACL + forced masking (H5).
 * Mirrors agenticx.data_suite.acl — platform-generic fake roles/datasets only.
 */
import {
  SAMPLE_MASKING_POLICY,
  SAMPLE_SECURITY_ROWS,
  maskRows,
  type MaskStrategy,
} from "./data-security-fixture";

export type QueryAclGrant = {
  role: string;
  datasets: string[];
  boards: string[];
  /** When set, only these fields may be requested (allowlist). */
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

/** Desensitized sample rows for self-serve query demos (phone/email PII). */
export const SAMPLE_QUERY_ROWS: Array<Record<string, string>> = SAMPLE_SECURITY_ROWS.map((r) => ({
  ...r,
  member_id: "M-001",
}));

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

function grantFor(policy: QueryAclPolicy, role: string): QueryAclGrant | undefined {
  return policy.grants.find((g) => g.role === role);
}

export function checkQueryAccess(
  policy: QueryAclPolicy,
  opts: {
    role: string;
    datasetId: string;
    boardId?: string | null;
    fields?: string[] | null;
  },
): AccessDecision {
  const grant = grantFor(policy, opts.role);
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
      if (!matches(grant.fields, f)) {
        return { allowed: false, reason: `field_denied:${f}` };
      }
    }
  }
  return { allowed: true, reason: "granted" };
}

export function assertQueryAccess(
  policy: QueryAclPolicy,
  opts: {
    role: string;
    datasetId: string;
    boardId?: string | null;
    fields?: string[] | null;
  },
): AccessDecision {
  const decision = checkQueryAccess(policy, opts);
  if (!decision.allowed) throw new QueryAccessDenied(decision.reason);
  return decision;
}

/**
 * Self-serve read: ACL then **forced** masking. Cannot return raw sensitive fields
 * when a masking policy is bound.
 */
export function secureQueryRows(
  rows: Array<Record<string, string>>,
  opts: {
    role: string;
    datasetId: string;
    boardId?: string | null;
    fields?: string[] | null;
    acl?: QueryAclPolicy;
    maskingPolicy?: typeof SAMPLE_MASKING_POLICY;
  },
): Array<Record<string, string | null>> {
  const acl = opts.acl ?? SAMPLE_QUERY_ACL;
  assertQueryAccess(acl, {
    role: opts.role,
    datasetId: opts.datasetId,
    boardId: opts.boardId,
    fields: opts.fields,
  });
  const policy = opts.maskingPolicy ?? SAMPLE_MASKING_POLICY;
  return maskRows(rows, opts.role, policy);
}

export type { MaskStrategy };
