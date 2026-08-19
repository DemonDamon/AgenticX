"use client";

import { Badge, Checkbox } from "@agenticx/ui";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";

import type { CapabilityChoice } from "../../lib/capability-pack-form";

/**
 * 这项能力自己的配置在哪一页。
 *
 * 包里勾中一项之后，下一个问题往往是「它本身怎么配」——搜索的 key 和配额、MCP 的地址和
 * 凭据、Skill 的包体。那些是租户级的一套设置，同一份被所有包共用，所以不能塞进某个包的
 * 编辑弹窗里；但也不该让人自己去猜在哪个 tab。给一条链接。
 */
function configHref(item: CapabilityChoice): string | null {
  if (item.kind === "feature") {
    return item.name === "web_search" || item.name === "deep_research"
      ? "/admin/capabilities?tab=search"
      : null;
  }
  if (item.kind === "mcp") return "/admin/capabilities?tab=mcp";
  if (item.kind === "skill") return "/admin/capabilities?tab=skills";
  return null;
}

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
      {items.map((item) => {
        const href = configHref(item);
        return (
          <div key={item.id} className="flex items-center gap-2 text-sm">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <Checkbox
                checked={selected.includes(item.id)}
                onCheckedChange={() => onToggle(item.id)}
              />
              <span className="truncate">{item.displayName}</span>
              <span className="truncate text-xs text-muted-foreground">{item.name}</span>
              {item.disabled && <Badge variant="secondary">{disabledLabel}</Badge>}
            </label>
            {href ? (
              <Link
                href={href}
                className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                title="打开这项能力自己的配置"
              >
                <SlidersHorizontal className="h-3 w-3" />
                配置
              </Link>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
