"use client";

import { Button } from "@agenticx/ui";
import { RefreshCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RuntimeObserve } from "../../../components/RuntimeObserve";

const ObservePage = dynamic(() => import("../../metering/agent-traces/page"), { ssr: false });
const AuditPage = dynamic(() => import("../../audit/page"), { ssr: false });
const PortalLogsPage = dynamic(() => import("../../portal-logs/page"), { ssr: false });
const ErrorsPage = dynamic(() => import("../../admin/errors/page"), { ssr: false });
const PerfPage = dynamic(() => import("../../admin/perf/page"), { ssr: false });
const ManagedSessionsPanel = dynamic(() => import("../../../components/managed-sessions/ManagedSessionsPanel"), { ssr: false });

const TABS = [
  { id: "overview", label: "总览" },
  { id: "traces", label: "调用链" },
  { id: "sessions", label: "会话" },
  { id: "managed", label: "托管会话" },
  { id: "audit", label: "审计" },
  { id: "portal", label: "Portal" },
  { id: "errors", label: "错误聚类" },
  { id: "perf", label: "性能分析" },
] as const;

type TabId = (typeof TABS)[number]["id"];
type ObserveTab = "overview" | "traces" | "sessions";

function normalizeTab(value: string | null): TabId {
  if (value === "observe" || value === null) return "overview";
  if (TABS.some((tab) => tab.id === value)) return value as TabId;
  return "overview";
}

function isObserveTab(value: TabId): value is ObserveTab {
  return value === "overview" || value === "traces" || value === "sessions";
}

function LogObserve() {
  const params = useSearchParams();
  const [tab, setTab] = useState<TabId>(() => normalizeTab(params.get("tab")));
  const [observeSection, setObserveSection] = useState<ObserveTab>(() => {
    const initial = normalizeTab(params.get("tab"));
    return isObserveTab(initial) ? initial : "overview";
  });
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set([normalizeTab(params.get("tab"))]));
  const [reloadToken, setReloadToken] = useState(0);

  const open = (next: TabId) => {
    setTab(next);
    if (next === "traces" || next === "sessions") setObserveSection(next);
    setVisited((current) => {
      if (current.has(next)) return current;
      const nextVisited = new Set(current);
      nextVisited.add(next);
      return nextVisited;
    });
    const query = new URLSearchParams(window.location.search);
    query.set("tab", next);
    window.history.replaceState(null, "", `/ops/logs?${query.toString()}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-1">
        <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border/70 bg-muted/60 p-1">
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => open(item.id)}
                className={[
                  "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg px-3.5 text-xs font-medium transition-all",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setReloadToken((current) => current + 1)}>
          <RefreshCcw />
          刷新
        </Button>
      </div>
      <div className={tab === "overview" ? "px-6 pt-4 pb-6" : "hidden"}>
        <RuntimeObserve reloadToken={reloadToken} />
      </div>
      <div className={tab === "traces" || tab === "sessions" ? undefined : "hidden"}>
        <ObservePage embedded section={observeSection === "sessions" ? "sessions" : "traces"} onSection={open} reloadToken={reloadToken} />
      </div>
      {visited.has("managed") ? (
        <div className={tab === "managed" ? "px-6 pt-4 pb-6" : "hidden"}>
          <ManagedSessionsPanel reloadToken={reloadToken} />
        </div>
      ) : null}
      {visited.has("audit") ? (
        <div className={tab === "audit" ? undefined : "hidden"}>
          <AuditPage embedded />
        </div>
      ) : null}
      {visited.has("portal") ? (
        <div className={tab === "portal" ? undefined : "hidden"}>
          <PortalLogsPage embedded />
        </div>
      ) : null}
      {visited.has("errors") ? (
        <div className={tab === "errors" ? undefined : "hidden"}>
          <ErrorsPage />
        </div>
      ) : null}
      {visited.has("perf") ? (
        <div className={tab === "perf" ? undefined : "hidden"}>
          <PerfPage />
        </div>
      ) : null}
    </div>
  );
}

export default function LogObservePage() {
  return (
    <Suspense fallback={null}>
      <LogObserve />
    </Suspense>
  );
}
