"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@agenticx/ui";
import type { CollabProject } from "../../lib/collab-room/types";

type ProjectListViewProps = {
  currentUserEmail: string;
};

type Envelope<T> = { data?: T };

function formatTime(iso: string | null | undefined, locale: string, empty: string): string {
  if (!iso) return empty;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return empty;
  const tag = locale.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
  return date.toLocaleString(tag, { hour12: false });
}

export function ProjectListView({ currentUserEmail }: ProjectListViewProps) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const [projects, setProjects] = useState<CollabProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const body = (await res.json()) as Envelope<{ projects: CollabProject[] }>;
        if (!res.ok) throw new Error(t("loadFailed"));
        if (!cancelled) setProjects(body.data?.projects ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <Link href="/workspace" className="text-sm text-muted-foreground hover:text-foreground">
            {t("backToWorkspace")}
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{t("title")}</h1>
          <p className="truncate text-xs text-muted-foreground">{currentUserEmail}</p>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
        {!loading && projects.length === 0 ? (
          <Card>
            <CardContent className="py-10">
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="block w-full rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{project.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t("memberCount", { count: project.member_count })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatTime(project.updated_at, locale, t("noActivity"))}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
