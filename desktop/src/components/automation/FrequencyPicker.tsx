import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AutomationFrequency } from "./types";

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
  const { t } = useTranslation("workspace");
  const [activeType, setActiveType] = useState<FreqType>(value.type);
  const dayLabels = useMemo(
    () => [
      { value: 1, label: t("automation.mon") },
      { value: 2, label: t("automation.tue") },
      { value: 3, label: t("automation.wed") },
      { value: 4, label: t("automation.thu") },
      { value: 5, label: t("automation.fri") },
      { value: 6, label: t("automation.sat") },
      { value: 7, label: t("automation.sun") },
    ],
    [t],
  );

  const switchType = (freqType: FreqType) => {
    setActiveType(freqType);
    if (freqType === "daily") {
      onChange({ type: "daily", time: "time" in value ? value.time : "09:00", days: "days" in value ? value.days : [1, 2, 3, 4, 5, 6, 7] });
    } else if (freqType === "interval") {
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
      <div className="text-sm font-medium text-text-strong">{t("automation.frequency")}</div>
      <div className="flex gap-1">
        {(["daily", "interval", "once"] as FreqType[]).map((freqType) => (
          <button
            key={freqType}
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeType === freqType
                ? "bg-surface-card text-text-strong"
                : "text-text-muted hover:bg-surface-card hover:text-text-primary"
            }`}
            onClick={() => switchType(freqType)}
          >
            {freqType === "daily" ? t("automation.freqDaily") : freqType === "interval" ? t("automation.freqInterval") : t("automation.freqOnce")}
          </button>
        ))}
      </div>

      {activeType === "daily" && value.type === "daily" && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="time"
            value={value.time}
            onChange={(e) => onChange({ ...value, time: e.target.value })}
            className="rounded-md border border-border bg-surface-card px-2 py-1.5 text-sm text-text-primary"
          />
          <div className="flex flex-wrap gap-1">
            {dayLabels.map((d) => (
              <button
                key={d.value}
                type="button"
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  value.days.includes(d.value)
                    ? "bg-text-strong text-surface-panel"
                    : "bg-surface-card text-text-muted hover:bg-surface-hover"
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
            <span className="text-xs text-text-muted">{t("automation.every")}</span>
            <input
              type="number"
              min={1}
              max={24}
              value={value.hours}
              onChange={(e) => onChange({ ...value, hours: Math.max(1, Math.min(24, Number(e.target.value) || 1)) })}
              className="w-16 rounded-md border border-border bg-surface-card px-2 py-1.5 text-center text-sm text-text-primary"
            />
            <span className="text-xs text-text-muted">{t("automation.hours")}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {dayLabels.map((d) => (
              <button
                key={d.value}
                type="button"
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  value.days.includes(d.value)
                    ? "bg-text-strong text-surface-panel"
                    : "bg-surface-card text-text-muted hover:bg-surface-hover"
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
            className="rounded-md border border-border bg-surface-card px-2 py-1.5 text-sm text-text-primary"
          />
          <input
            type="date"
            value={value.date}
            onChange={(e) => onChange({ ...value, date: e.target.value })}
            className="rounded-md border border-border bg-surface-card px-2 py-1.5 text-sm text-text-primary"
          />
        </div>
      )}
    </div>
  );
}
