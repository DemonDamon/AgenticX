export type PolicyRuleKind = "keyword" | "regex" | "pii";
export type PolicyRuleAction = "block" | "redact" | "warn";
export type PolicyRuleSeverity = "low" | "medium" | "high" | "critical";
export type PolicyRuleStatus = "draft" | "active" | "disabled";
export type PolicyPackSource = "builtin" | "custom";
export type PolicyPublishStatus = "published" | "rolled_back";
export type PolicyStage = "request" | "response";

export type PolicyAppliesTo = {
  version: 1;
  departmentIds: string[];
  departmentRecursive: boolean;
  roleCodes: string[];
  userIds: string[];
  userExcludeIds: string[];
  clientTypes: string[];
  stages: PolicyStage[];
};

export const DEFAULT_POLICY_APPLIES_TO: PolicyAppliesTo = {
  version: 1,
  departmentIds: ["*"],
  departmentRecursive: true,
  roleCodes: ["*"],
  userIds: [],
  userExcludeIds: [],
  clientTypes: ["*"],
  stages: ["request", "response"],
};

export type PolicyPack = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  source: PolicyPackSource;
  enabled: boolean;
  appliesTo: PolicyAppliesTo;
  createdAt: string;
  updatedAt: string;
};

export type PolicyRulePayload = {
  keywords?: string[];
  pattern?: string;
  piiType?: string;
};

export type PolicyRule = {
  id: string;
  tenantId: string;
  packId: string;
  code: string;
  kind: PolicyRuleKind;
  action: PolicyRuleAction;
  severity: PolicyRuleSeverity;
  message: string | null;
  payload: PolicyRulePayload;
  appliesTo: PolicyAppliesTo | null;
  status: PolicyRuleStatus;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertPolicyPackInput = {
  id?: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  source?: PolicyPackSource;
  enabled?: boolean;
  appliesTo?: Partial<PolicyAppliesTo> | null;
};

export type UpsertPolicyRuleInput = {
  id?: string;
  tenantId: string;
  packId: string;
  code: string;
  kind: PolicyRuleKind;
  action: PolicyRuleAction;
  severity: PolicyRuleSeverity;
  message?: string | null;
  payload: PolicyRulePayload;
  appliesTo?: Partial<PolicyAppliesTo> | null;
  status?: PolicyRuleStatus;
  updatedBy?: string | null;
};

export type PolicyRuleFilter = {
  packCode?: string;
  kind?: PolicyRuleKind;
  status?: PolicyRuleStatus;
};

export type PolicyTestHit = {
  ruleId: string;
  code: string;
  kind: PolicyRuleKind;
  action: PolicyRuleAction;
  severity: PolicyRuleSeverity;
  message: string | null;
  matched: string;
  stage: PolicyStage;
};

/** 与已落库规则合并后再跑样本测试（用于未保存的表单改动） */
export type PolicyRuleTestPreview = Partial<
  Pick<PolicyRule, "action" | "kind" | "severity" | "message" | "payload">
>;

export type PolicyTestResult = {
  blocked: boolean;
  redactedText: string;
  hits: PolicyTestHit[];
};

export type PolicySnapshotRule = Omit<PolicyRule, "tenantId" | "packId" | "createdAt" | "updatedAt">;

export type PolicySnapshotPack = {
  code: string;
  name: string;
  description: string | null;
  source: PolicyPackSource;
  enabled: boolean;
  appliesTo: PolicyAppliesTo;
  rules: PolicySnapshotRule[];
};

export type PolicySnapshot = {
  tenantId: string;
  version: number;
  publishId?: string;
  publishedAt: string;
  publisher: string | null;
  deptIndex: Record<string, string[]>;
  packs: PolicySnapshotPack[];
};

export type PolicyPublishEvent = {
  id: string;
  tenantId: string;
  version: number;
  snapshot: PolicySnapshot;
  summary: Record<string, unknown> | null;
  publisher: string | null;
  publishedAt: string;
  status: PolicyPublishStatus;
};

export type PublishResult = {
  event: PolicyPublishEvent;
  snapshotPath: string;
};
