import type { RoiReportRow } from "../types";

export type RoiCostRow = { label: string; cost_usd: number };
export type RoiRevenueRow = { scenario_label: string; revenue_usd: number };

export function computeRoiRows(costs: RoiCostRow[], revenues: RoiRevenueRow[]): RoiReportRow[] {
  const costByLabel = new Map<string, number>();
  for (const row of costs) {
    costByLabel.set(row.label, (costByLabel.get(row.label) ?? 0) + row.cost_usd);
  }
  const revenueByLabel = new Map<string, number>();
  for (const row of revenues) {
    revenueByLabel.set(row.scenario_label, (revenueByLabel.get(row.scenario_label) ?? 0) + row.revenue_usd);
  }

  const labels = new Set<string>([...costByLabel.keys(), ...revenueByLabel.keys()]);
  const rows: RoiReportRow[] = [...labels].map((label) => {
    const cost_usd = costByLabel.get(label) ?? 0;
    const revenue_usd = revenueByLabel.get(label) ?? 0;
    const net_usd = revenue_usd - cost_usd;
    const roi = cost_usd > 0 ? net_usd / cost_usd : null;
    return { label, cost_usd, revenue_usd, net_usd, roi };
  });

  rows.sort((a, b) => {
    const aRoi = a.roi ?? Number.NEGATIVE_INFINITY;
    const bRoi = b.roi ?? Number.NEGATIVE_INFINITY;
    if (bRoi !== aRoi) return bRoi - aRoi;
    return b.revenue_usd - a.revenue_usd;
  });
  return rows;
}

export function roiRowsToCsv(rows: RoiReportRow[]): string {
  const header = "label,cost_usd,revenue_usd,net_usd,roi";
  const body = rows.map((row) => {
    const roi = row.roi == null ? "" : row.roi.toFixed(6);
    return [row.label, row.cost_usd.toFixed(8), row.revenue_usd.toFixed(8), row.net_usd.toFixed(8), roi].join(",");
  });
  return [header, ...body].join("\n");
}
