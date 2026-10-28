"use client";

import { useMemo, useState } from "react";
import {
  BarCard,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DonutCard,
  LineCard,
  PageHeader,
  StatCard,
  chartPalette,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { LayoutDashboard } from "lucide-react";
import {
  SAMPLE_BOARD,
  SAMPLE_MEMBER_ROWS,
  applyDrill,
  bindWidget,
  type BoardWidget,
  type ChartPoint,
} from "../../../lib/data-board-fixture";

function pointsToBarData(points: ChartPoint[]) {
  return points.map((p) => ({ name: p.name, value: p.value }));
}

function WidgetView({
  widget,
  points,
  comparePoints,
  compare,
}: {
  widget: BoardWidget;
  points: ChartPoint[];
  comparePoints?: ChartPoint[];
  compare: boolean;
}) {
  if (widget.chart === "stat") {
    return (
      <StatCard
        label={widget.title}
        value={String(points[0]?.value ?? 0)}
        icon={<LayoutDashboard />}
        accentClassName="bg-primary"
      />
    );
  }
  if (widget.chart === "donut") {
    return (
      <DonutCard
        title={widget.title}
        data={points.map((p, i) => ({
          name: p.name,
          value: p.value,
          color: chartPalette[i % chartPalette.length],
        }))}
        height={240}
      />
    );
  }
  if (widget.chart === "line") {
    const names = new Set(points.map((p) => p.name));
    if (compare && comparePoints) comparePoints.forEach((p) => names.add(p.name));
    const data = [...names].sort().map((name) => {
      const row: Record<string, string | number> = { name };
      row.A = points.find((p) => p.name === name)?.value ?? 0;
      if (compare && comparePoints) {
        row.B = comparePoints.find((p) => p.name === name)?.value ?? 0;
      }
      return row;
    });
    return (
      <LineCard
        title={widget.title}
        data={data}
        xKey="name"
        series={
          compare
            ? [
                { key: "A", label: "A", color: chartPalette[0] },
                { key: "B", label: "B", color: chartPalette[2] },
              ]
            : [{ key: "A", label: "value", color: chartPalette[0] }]
        }
        height={240}
      />
    );
  }
  // bar (+ optional compare as two series)
  const names = new Set(points.map((p) => p.name));
  if (compare && comparePoints) comparePoints.forEach((p) => names.add(p.name));
  const data = [...names].sort().map((name) => {
    const row: Record<string, string | number> = { name };
    row.A = points.find((p) => p.name === name)?.value ?? 0;
    if (compare && comparePoints) {
      row.B = comparePoints.find((p) => p.name === name)?.value ?? 0;
    }
    return row;
  });
  return (
    <BarCard
      title={widget.title}
      data={compare ? data : pointsToBarData(points)}
      xKey="name"
      series={
        compare
          ? [
              { key: "A", label: "A", color: chartPalette[0] },
              { key: "B", label: "B", color: chartPalette[2] },
            ]
          : [{ key: "value", label: "value", color: chartPalette[0] }]
      }
      height={240}
    />
  );
}

export default function AdminDataBoardsSection() {
  const t = useTranslations("pages.admin.dataBoards");
  const [drillValues, setDrillValues] = useState<string[]>([]);
  const [compare, setCompare] = useState(false);

  const drilledRows = useMemo(
    () => applyDrill(SAMPLE_MEMBER_ROWS, SAMPLE_BOARD.drillLevels, drillValues),
    [drillValues],
  );

  const nextLevel = SAMPLE_BOARD.drillLevels[drillValues.length];
  const nextOptions = useMemo(() => {
    if (!nextLevel) return [] as string[];
    return [...new Set(drilledRows.map((r) => String((r as Record<string, unknown>)[nextLevel] ?? "")))].sort();
  }, [drilledRows, nextLevel]);

  return (
    <div className="space-y-6" data-testid="data-boards-page">
      <PageHeader title={t("title")} description={t("description")} />

      <Card data-testid="data-boards-sample">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle data-testid="data-boards-title">{SAMPLE_BOARD.title}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={compare ? "default" : "outline"}
              data-testid="data-boards-compare"
              onClick={() => setCompare((v) => !v)}
            >
              {compare ? t("compareOn") : t("compareOff")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="data-boards-drill-reset"
              onClick={() => setDrillValues([])}
              disabled={drillValues.length === 0}
            >
              {t("drillReset")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground" data-testid="data-boards-drill-path">
            {t("drillPath")}: {drillValues.length ? drillValues.join(" / ") : t("drillRoot")}
          </div>
          {nextLevel ? (
            <div className="flex flex-wrap gap-2" data-testid="data-boards-drill-options">
              {nextOptions.map((opt) => (
                <Button
                  key={opt}
                  size="sm"
                  variant="secondary"
                  data-testid={`data-boards-drill-${opt}`}
                  onClick={() => setDrillValues((prev) => [...prev, opt])}
                >
                  {nextLevel}={opt}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            {SAMPLE_BOARD.widgets.map((widget) => {
              const points = bindWidget(
                widget,
                drilledRows,
                compare ? { status: "active" } : {},
              );
              const comparePoints = compare
                ? bindWidget(widget, drilledRows, { status: "inactive" })
                : undefined;
              return (
                <div key={widget.id} data-testid={`data-boards-widget-${widget.id}`}>
                  <WidgetView
                    widget={widget}
                    points={points}
                    comparePoints={comparePoints}
                    compare={compare}
                  />
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t("stubNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
