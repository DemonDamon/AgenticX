import {
  HeatmapApi,
  MeteringApi,
  MeteringService,
  RoiApi,
  RoiService,
  type HeatmapDimension,
  type HeatmapMetric,
  type HeatmapTimeGranularity,
  type MeteringGroupKey,
} from "@agenticx/feature-metering";

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
