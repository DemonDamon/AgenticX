/** Mirrors tests/data_suite/fixtures/sample_board.yaml + sample_board_rows.json for admin UI. */

export type BoardWidget = {
  id: string;
  title: string;
  chart: "bar" | "line" | "donut" | "stat";
  dataset: string;
  group_by?: string;
  metric: "count" | "sum" | "avg";
  metric_field?: string;
};

export type BoardSpec = {
  id: string;
  title: string;
  drillLevels: string[];
  widgets: BoardWidget[];
};

export type MemberRow = {
  member_id: string;
  region: string;
  tier: string;
  status: string;
  orders: number;
  brand: string;
  line: string;
  config: string;
};

export const SAMPLE_BOARD: BoardSpec = {
  id: "sample_member_board",
  title: "Member overview (sample)",
  drillLevels: ["brand", "line", "config"],
  widgets: [
    {
      id: "members_by_region",
      title: "Members by region",
      chart: "bar",
      dataset: "members",
      group_by: "region",
      metric: "count",
    },
    {
      id: "members_by_tier",
      title: "Members by tier",
      chart: "donut",
      dataset: "members",
      group_by: "tier",
      metric: "count",
    },
    {
      id: "active_count",
      title: "Active members",
      chart: "stat",
      dataset: "members",
      metric: "count",
    },
    {
      id: "avg_orders",
      title: "Avg orders",
      chart: "line",
      dataset: "members",
      group_by: "region",
      metric: "avg",
      metric_field: "orders",
    },
  ],
};

export const SAMPLE_MEMBER_ROWS: MemberRow[] = [
  { member_id: "1", region: "east", tier: "gold", status: "active", orders: 3, brand: "A", line: "L1", config: "C1" },
  { member_id: "2", region: "east", tier: "silver", status: "active", orders: 1, brand: "A", line: "L1", config: "C2" },
  { member_id: "3", region: "west", tier: "gold", status: "inactive", orders: 5, brand: "A", line: "L2", config: "C1" },
  { member_id: "4", region: "west", tier: "bronze", status: "active", orders: 2, brand: "B", line: "L1", config: "C1" },
  { member_id: "5", region: "north", tier: "gold", status: "active", orders: 4, brand: "B", line: "L2", config: "C3" },
];

export type ChartPoint = { name: string; value: number };

function metricValue(rows: MemberRow[], metric: BoardWidget["metric"], field?: string): number {
  if (rows.length === 0) return 0;
  if (metric === "count") return rows.length;
  if (!field) return 0;
  const vals = rows.map((r) => Number((r as Record<string, unknown>)[field] ?? 0));
  if (metric === "sum") return vals.reduce((a, b) => a + b, 0);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function applyDrill(rows: MemberRow[], levels: string[], values: string[]): MemberRow[] {
  return rows.filter((row) =>
    levels.every((level, i) => i >= values.length || String((row as Record<string, unknown>)[level] ?? "") === values[i]),
  );
}

export function bindWidget(
  widget: BoardWidget,
  rows: MemberRow[],
  filters: Record<string, string> = {},
): ChartPoint[] {
  const filtered = rows.filter((r) =>
    Object.entries(filters).every(([k, v]) => String((r as Record<string, unknown>)[k] ?? "") === v),
  );
  if (widget.chart === "stat" || !widget.group_by) {
    return [{ name: widget.title, value: metricValue(filtered, widget.metric, widget.metric_field) }];
  }
  const groups = new Map<string, MemberRow[]>();
  for (const r of filtered) {
    const key = String((r as Record<string, unknown>)[widget.group_by] ?? "");
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, grp]) => ({ name, value: metricValue(grp, widget.metric, widget.metric_field) }));
}
