"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  Checkbox,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from "@agenticx/ui";
import {
  ArrowLeft,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Search,
  Trash2,
} from "lucide-react";
import {
  formatHistoryRelativeTime,
  groupHistory,
  sortHistorySessions,
  type HistoryListItem,
} from "../lib/history-grouping";

export type HistorySessionsPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: HistoryListItem[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string) => void;
  onPin: (sessionId: string, pinned: boolean) => void;
  onDelete: (sessionId: string) => void;
  onDeleteMany: (sessionIds: string[]) => void;
};

export function HistorySessionsPanel({
  open,
  onOpenChange,
  sessions,
  activeSessionId,
  onSelect,
  onRename,
  onPin,
  onDelete,
  onDeleteMany,
}: HistorySessionsPanelProps) {
  const t = useTranslations("workspace");
  const locale = useLocale();
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const selecting = selected.size > 0;

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(new Set());
    }
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = sortHistorySessions(sessions);
    if (!q) return base;
    return base.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.preview ?? "").toLowerCase().includes(q),
    );
  }, [sessions, query]);

  const grouped = React.useMemo(
    () =>
      groupHistory(filtered, {
        pinned: t("historyPinned"),
        today: t("historyToday"),
        yesterday: t("historyYesterday"),
        week: t("historyWeek"),
        month: t("historyMonth"),
        older: t("historyOlder"),
      }),
    [filtered, t],
  );

  const toggleSelect = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelect = React.useCallback(() => setSelected(new Set()), []);

  const confirmBatchDelete = React.useCallback(() => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(t("batchDeleteConfirm", { count: ids.length }))) return;
    onDeleteMany(ids);
    exitSelect();
  }, [exitSelect, onDeleteMany, selected, t]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border px-5 py-4 pr-12 text-left">
          <SheetTitle className="text-xl font-semibold tracking-tight">
            {t("historyAllTitle")}
          </SheetTitle>
          <SheetDescription className="sr-only">{t("historyAllDescription")}</SheetDescription>
        </SheetHeader>

        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("historySearchPlaceholder")}
              className="h-10 rounded-full border-border/70 bg-muted/40 pl-9"
            />
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-24">
          {grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center text-sm text-muted-foreground">
              <MessageSquare className="h-5 w-5" />
              <span>{query.trim() ? t("historySearchEmpty") : t("noHistory")}</span>
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map((group) => (
                <section key={group.key}>
                  <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </div>
                  <ul className="space-y-1.5">
                    {group.items.map((item) => {
                      const pinned = Boolean(item.pinnedAt && item.pinnedAt > 0);
                      const isActive = activeSessionId === item.id;
                      const isChecked = selected.has(item.id);
                      return (
                        <li key={item.id}>
                          <div
                            className={cn(
                              "group/card flex items-stretch gap-2 rounded-xl border border-transparent px-2 py-2.5 transition-colors",
                              isActive || isChecked ? "bg-muted/70" : "hover:bg-muted/50",
                            )}
                          >
                            <div
                              className="flex h-9 w-9 shrink-0 items-center justify-center self-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={() => toggleSelect(item.id)}
                                aria-label={t("historySelect")}
                                className="rounded-full"
                              />
                            </div>

                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() => {
                                onSelect(item.id);
                                onOpenChange(false);
                              }}
                            >
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    {pinned ? (
                                      <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />
                                    ) : null}
                                    <span className="truncate text-sm font-semibold text-foreground">
                                      {item.title}
                                    </span>
                                  </div>
                                  {item.preview ? (
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                      {item.preview}
                                    </p>
                                  ) : null}
                                </div>
                                <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                                  {formatHistoryRelativeTime(item.createdAt, locale)}
                                </span>
                              </div>
                            </button>

                            <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="h-8 w-8 text-muted-foreground"
                                aria-label={t("rename")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRename(item.id);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="h-8 w-8 text-muted-foreground"
                                aria-label={pinned ? t("unpin") : t("pin")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPin(item.id, !pinned);
                                }}
                              >
                                {pinned ? (
                                  <PinOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Pin className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                aria-label={t("delete")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (window.confirm(t("deleteSessionConfirm"))) {
                                    onDelete(item.id);
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        {selecting ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
            <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-full border border-border bg-background px-3 py-2 shadow-lg">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={exitSelect}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                {t("batchExit")}
              </Button>
              <span className="flex-1 text-center text-xs text-muted-foreground">
                {t("batchSelected", { count: selected.size })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-full text-destructive hover:text-destructive"
                onClick={confirmBatchDelete}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t("delete")}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
