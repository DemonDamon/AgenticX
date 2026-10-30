export type RuleMeta = {
  scope?: string;
  priority?: number;
  trigger?: string;
  depends_on?: string[];
  tags?: string[];
};

export type RuleRow = {
  id: string;
  name: string;
  status: string;
  version: number;
  enabled: boolean;
  body: Record<string, unknown>;
  meta: RuleMeta;
  created_at?: string;
  updated_at?: string;
};

export type ExecutionRow = {
  id: string;
  rule_id: string;
  rule_version: number;
  status: string;
  nodes: Record<string, unknown>[];
  error?: string | null;
  started_at?: string;
  finished_at?: string;
};

/** 示例化工厂·冷却回路 synthetic seed (desensitized demo). */
export const SAMPLE_RULES: RuleRow[] = [
  {
    id: "rule-cooling-overtemp",
    name: "冷却回路超温告警",
    status: "active",
    version: 1,
    enabled: true,
    body: {
      object: "device",
      trigger: { type: "event", event: "metric.breach" },
      condition: { field: "temperature", op: "gt", value: 80 },
      actions: [{ type: "notify", target: "duty-channel", params: { level: "warn" } }],
      feedback: { channel: "duty-channel" },
    },
    meta: {
      scope: "workspace-sample-plant",
      priority: 50,
      trigger: "event",
      tags: ["ops", "sample", "cooling-loop"],
    },
  },
];
