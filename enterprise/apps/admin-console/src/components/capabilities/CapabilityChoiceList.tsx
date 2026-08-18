"use client";

import { Badge, Checkbox } from "@agenticx/ui";

import type { CapabilityChoice } from "../../lib/capability-pack-form";

/** 成员/依赖两处共用的勾选清单。 */
export function CapabilityChoiceList({
  items,
  selected,
  onToggle,
  emptyLabel,
  disabledLabel,
}: {
  items: CapabilityChoice[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyLabel: string;
  disabledLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <label key={item.id} className="flex items-center gap-2 text-sm">
          <Checkbox checked={selected.includes(item.id)} onCheckedChange={() => onToggle(item.id)} />
          <span>{item.displayName}</span>
          <span className="text-xs text-muted-foreground">{item.name}</span>
          {item.disabled && <Badge variant="secondary">{disabledLabel}</Badge>}
        </label>
      ))}
    </div>
  );
}
