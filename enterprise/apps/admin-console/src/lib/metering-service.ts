import {
  AgentUsageService,
  HeatmapApi,
  MeteringApi,
  MeteringService,
  RoiApi,
  RoiService,
  agentQuotaWindowLabels,
  resolveQuotaTimeZone,
  type AgentQuotaWindowTotals,
  type AgentQuotaWindows,
  type AgentUsageGroupKey,
  type AgentUsageRow,
  type HeatmapDimension,
  type HeatmapMetric,
  type HeatmapTimeGranularity,
  type MeteringGroupKey,
} from "@agenticx/feature-metering";
import {
  deleteMaAgentQuota,
  getEffectiveMaAgentQuota,
  listMaAgentQuotas,
  toAgentQuotaRecord,
  upsertMaAgentQuota,
  type MaAgentQuota,
} from "@agenticx/iam-core";

const meteringService = new MeteringService();
const meteringApi = new MeteringApi(meteringService);
const heatmapApi = new HeatmapApi(meteringService);
const roiService = new RoiService();
const roiApi = new RoiApi(roiService);

const FALLBACK_TENANT_ID = "01J00000000000000000000001";

function resolveTenantId(): string {
  const value = process.env.DEFAULT_TENANT_ID?.trim();
  return value && value.length > 0 ? value : FALLBACK_TENANT_ID;
}

export async function queryMetering(input: {
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
  start: string;
  end: string;
  group_by: MeteringGroupKey[];
}) {
  return meteringApi.query({
    tenant_id: resolveTenantId(),
    ...input,
  });
}

export async function queryHeatmap(input: {
  dimension: HeatmapDimension;
  time_granularity: HeatmapTimeGranularity;
  metric?: HeatmapMetric;
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
  start: string;
  end: string;
  limit_dimensions?: number;
}) {
  return heatmapApi.query({
    tenant_id: resolveTenantId(),
    ...input,
  });
}

export async function queryRoiReport(input: {
  dimension: HeatmapDimension;
  start: string;
  end: string;
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
}) {
  return roiApi.report({
    tenant_id: resolveTenantId(),
    ...input,
  });
}

export async function exportRoiReportCsv(input: {
  dimension: HeatmapDimension;
  start: string;
  end: string;
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
}) {
  return roiApi.reportCsv({
    tenant_id: resolveTenantId(),
    ...input,
  });
}

export async function listBusinessRevenues() {
  return roiApi.listRevenues(resolveTenantId());
}

export async function createBusinessRevenue(input: {
  scenario_label: string;
  period_start: string;
  period_end: string;
  revenue_usd: number;
  notes?: string | null;
}) {
  return roiApi.createRevenue({
    tenant_id: resolveTenantId(),
    ...input,
  });
}

export async function updateBusinessRevenue(
  id: string,
  patch: {
    scenario_label?: string;
    period_start?: string;
    period_end?: string;
    revenue_usd?: number;
    notes?: string | null;
  }
) {
  return roiApi.updateRevenue(resolveTenantId(), id, patch);
}

export async function deleteBusinessRevenue(id: string) {
  return roiApi.deleteRevenue(resolveTenantId(), id);
}

// ---------- Diagnostics (new) ----------

export async function queryOverviewStats(input: {
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
  start: string;
  end: string;
}) {
  return meteringApi.overview({
    tenant_id: resolveTenantId(),
    ...input,
  });
}

export async function queryTraceList(input: {
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
  start: string;
  end: string;
  limit?: number;
}) {
  return meteringApi.traceList({
    tenant_id: resolveTenantId(),
    ...input,
  });
}

export async function queryHourlyModelRidge(input: {
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
  start: string;
  end: string;
  top_n?: number;
}) {
  return meteringApi.hourlyRidge({
    tenant_id: resolveTenantId(),
    ...input,
  });
}

let agentUsageService: AgentUsageService | null = null;

export function quotaTimeZone(): string {
  return resolveQuotaTimeZone(process.env.MA_QUOTA_TIMEZONE);
}

function agentUsage(): AgentUsageService {
  if (!agentUsageService) agentUsageService = new AgentUsageService({ timeZone: quotaTimeZone() });
  return agentUsageService;
}

export type AgentQuotaRuleRecord = ReturnType<typeof toAgentQuotaRecord>;

export async function queryAgentUsage(input: {
  start?: string;
  end?: string;
  agent_id?: string[];
  user_id?: string[];
  group_by: AgentUsageGroupKey[];
}): Promise<{ rows: AgentUsageRow[]; timezone: string; windows: AgentQuotaWindows }> {
  const timeZone = quotaTimeZone();
  const now = new Date();
  const result = await agentUsage().query({
    tenant_id: resolveTenantId(),
    start: input.start ?? new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString(),
    end: input.end ?? now.toISOString(),
    agent_id: input.agent_id,
    user_id: input.user_id,
    group_by: input.group_by,
  });
  return { rows: result.rows, timezone: timeZone, windows: agentQuotaWindowLabels(now, timeZone) };
}

export async function listAgentQuotaView(agentId: string): Promise<{
  rules: AgentQuotaRuleRecord[];
  usage: Record<string, AgentQuotaWindowTotals>;
  timezone: string;
  windows: AgentQuotaWindows;
}> {
  const timeZone = quotaTimeZone();
  const now = new Date();
  const tenantId = resolveTenantId();
  const rules = await listMaAgentQuotas(tenantId, agentId);
  const userIds = rules.flatMap((rule) => (rule.subject === "user" && rule.userId ? [rule.userId] : []));
  const usage = await agentUsage().windowTotals(tenantId, agentId, userIds, now);
  return {
    rules: rules.map(toAgentQuotaRecord),
    usage,
    timezone: timeZone,
    windows: agentQuotaWindowLabels(now, timeZone),
  };
}

export async function saveAgentQuota(body: Record<string, unknown>, actorUserId: string): Promise<AgentQuotaRuleRecord> {
  quotaTimeZone();
  const saved = await upsertMaAgentQuota(resolveTenantId(), body, actorUserId);
  return toAgentQuotaRecord(saved);
}

export async function removeAgentQuota(quotaId: string): Promise<void> {
  quotaTimeZone();
  await deleteMaAgentQuota(resolveTenantId(), quotaId);
}

export async function readEffectiveAgentQuota(tenantId: string, agentId: string, userId: string): Promise<MaAgentQuota | null> {
  return getEffectiveMaAgentQuota(tenantId, agentId, userId);
}

export async function queryRequestSizeDistribution(input: {
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
  start: string;
  end: string;
  top_n?: number;
}) {
  return meteringApi.requestDistribution({
    tenant_id: resolveTenantId(),
    ...input,
  });
}
