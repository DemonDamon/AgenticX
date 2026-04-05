import { useState } from "react";
import type { AutomationFrequency } from "./types";

const DAY_LABELS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

type FreqType = "daily" | "interval" | "once";

interface Props {
  value: AutomationFrequency;
  onChange: (freq: AutomationFrequency) => void;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function FrequencyPicker({ value, onChange }: Props) {
  const [activeType, setActiveType] = useState<FreqType>(value.type);

  const switchType = (t: FreqType) => {
    setActiveType(t);
    if (t === "daily") {
      onChange({ type: "daily", time: "time" in value ? value.time : "09:00", days: "days" in value ? value.days : [1, 2, 3, 4, 5, 6, 7] });
    } else if (t === "interval") {
      onChange({ type: "interval", hours: 1, days: "days" in value ? value.days : [1, 2, 3, 4, 5, 6, 7] });
    } else {
      onChange({ type: "once", time: "time" in value ? value.time : "09:00", date: todayStr() });
    }
  };

  const toggleDay = (day: number) => {
    if (value.type === "once") return;
    const days = [...value.days];
    const idx = days.indexOf(day);
    if (idx >= 0) {
      if (days.length <= 1) return;
      days.splice(idx, 1);
    } else {
      days.push(day);
      days.sort((a, b) => a - b);
    }
    onChange({ ...value, days });
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-text-strong">执行频率</div>
      <div className="flex gap-1">
        {(["daily", "interval", "once"] as FreqType[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeType === t
                ? "bg-surface-card-strong text-text-strong"
                : "text-text-muted hover:bg-surface-card hover:text-text-primary"
            }`}
            onClick={() => switchType(t)}
          >
            {t === "daily" ? "每天" : t === "interval" ? "按间隔" : "单次"}
          </button>
        ))}
      </div>

      {activeType === "daily" && value.type === "daily" && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="time"
            value={value.time}
            onChange={(e) => onChange({ ...value, time: e.target.value })}
            className="rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
          />
          <div className="flex flex-wrap gap-1">
            {DAY_LABELS.map((d) => (
              <button
                key={d.value}
                type="button"
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  value.days.includes(d.value)
                    ? "bg-text-strong text-surface-panel"
                    : "bg-surface-card text-text-muted hover:bg-surface-card-strong"
                }`}
                onClick={() => toggleDay(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeType === "interval" && value.type === "interval" && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted">每</span>
            <input
              type="number"
              min={1}
              max={24}
              value={value.hours}
              onChange={(e) => onChange({ ...value, hours: Math.max(1, Math.min(24, Number(e.target.value) || 1)) })}
              className="w-16 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-center text-sm text-text-primary"
            />
            <span className="text-xs text-text-muted">小时</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {DAY_LABELS.map((d) => (
              <button
                key={d.value}
                type="button"
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  value.days.includes(d.value)
                    ? "bg-text-strong text-surface-panel"
                    : "bg-surface-card text-text-muted hover:bg-surface-card-strong"
                }`}
                onClick={() => toggleDay(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeType === "once" && value.type === "once" && (
        <div className="flex items-center gap-3">
          <input
            type="time"
            value={value.time}
            onChange={(e) => onChange({ ...value, time: e.target.value })}
            className="rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
          />
          <input
            type="date"
            value={value.date}
            onChange={(e) => onChange({ ...value, date: e.target.value })}
            className="rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
          />
        </div>
      )}
    </div>
  );
}
