"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@agenticx/ui";
import { chartPalette, chartTooltipStyle, chartLabelStyle, chartAxisTickProps, chartLegendWrapperStyle } from "@agenticx/ui";

type RidgeProps = {
  title: string;
  description?: string;
  hours: number[]; // 0-23
  models: string[];
  series: Record<string, number[]>; // model -> [tokens_per_hour]
  emptyLabel?: string;
};

export function RidgeChart({ title, description, hours, models, series, emptyLabel }: RidgeProps) {
  const data = useMemo(() => {
    return hours.map((h) => {
      const row: Record<string, number | string> = { hour: `${h}:00` };
      for (const m of models) {
        row[m] = series[m]?.[h] ?? 0;
      }
      return row;
    });
  }, [hours, models, series]);

  if (models.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
            {emptyLabel ?? "No data"}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="hour"
                stroke="var(--muted-foreground)"
                tick={chartAxisTickProps}
                axisLine={false}
                tickLine={false}
              />
              <YAxis stroke="var(--muted-foreground)" tick={chartAxisTickProps} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelStyle={{ ...chartLabelStyle, marginBottom: 4, fontWeight: 600, color: "var(--foreground)" }}
                itemStyle={chartLabelStyle}
                cursor={{ stroke: "var(--border)", strokeWidth: 1, strokeDasharray: "4 4" }}
                formatter={(value: number, name: string) => [value.toLocaleString(), name]}
              />
              <Legend iconType="circle" wrapperStyle={chartLegendWrapperStyle} />
              {models.map((m, i) => {
                const color = chartPalette[i % chartPalette.length];
                return (
                  <Area
                    key={m}
                    type="monotone"
                    dataKey={m}
                    name={m}
                    stackId="a"
                    stroke={color}
                    strokeWidth={1.5}
                    fill={color}
                    fillOpacity={0.55}
                    animationDuration={600}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
