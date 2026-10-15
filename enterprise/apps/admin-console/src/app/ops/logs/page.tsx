"use client";

import { Button } from "@agenticx/ui";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RuntimeObserve } from "../../../components/RuntimeObserve";

const ObservePage = dynamic(() => import("../../metering/agent-traces/page"), { ssr: false });
const AuditPage = dynamic(() => import("../../audit/page"), { ssr: false });
const PortalLogsPage = dynamic(() => import("../../portal-logs/page"), { ssr: false });
const ErrorsPage = dynamic(() => import("../../admin/errors/page"), { ssr: false });
const PerfPage = dynamic(() => import("../../admin/perf/page"), { ssr: false });

const TABS = [
  { id: "overview", label: "总览" },
  { id: "traces", label: "调用链" },
  { id: "sessions", label: "会话" },
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
      <div className="sticky top-0 z-20 flex flex-wrap gap-2 border-b border-border bg-background px-6 py-3">
        {TABS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={tab === item.id ? "default" : "outline"}
            onClick={() => open(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className={tab === "overview" ? "px-6 pt-6" : "hidden"}>
        <RuntimeObserve />
      </div>
      <div className={tab === "traces" || tab === "sessions" ? undefined : "hidden"}>
        <ObservePage embedded section={observeSection === "sessions" ? "sessions" : "traces"} onSection={open} />
      </div>
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
