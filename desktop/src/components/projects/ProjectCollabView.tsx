import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Boxes,
  Bug,
  ClipboardList,
  FolderKanban,
  LineChart,
  MoreHorizontal,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { MainViewShell } from "../ds/MainViewShell";
import { HoverTip } from "../ds/HoverTip";
import { CollabRoomPanel } from "../CollabRoomPanel";
import { GROUP_TEMPLATES, groupTemplateI18nKey } from "../groups/group-templates";
import { useAppStore } from "../../store";
import { NewProjectDialog } from "./NewProjectDialog";

type ProjectCard = {
  id: string;
  name: string;
  instructions: string;
  created_at: string;
};

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  "product-flow": ClipboardList,
  "market-research": LineChart,
  "team-kb": BookOpen,
  delivery: FolderKanban,
  "bug-track": Bug,
  "fullstack-squad": Boxes,
};

function relativeAdded(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const diffSec = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale.startsWith("en") ? "en" : "zh-CN", { numeric: "auto" });
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diffSec / (86400 * 30)), "month");
  return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
}

export function ProjectCollabView() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  if (activeProjectId) return <CollabRoomPanel variant="page" />;
  return <ProjectCollabHome />;
}

function ProjectCollabHome() {
  const { t, i18n } = useTranslation("projects");
  const { t: tSidebar } = useTranslation("sidebar");
  const openProject = useAppStore((s) => s.openProject);
  const openSettings = useAppStore((s) => s.openSettings);
  const setMainView = useAppStore((s) => s.setMainView);
  const [loggedIn, setLoggedIn] = useState(false);
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [query, setQuery] = useState("");
  const [listError, setListError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seedInstructions, setSeedInstructions] = useState("");
  const [seedTemplateId, setSeedTemplateId] = useState("");

  const refresh = useCallback(async () => {
    try {
      const account = await window.agenticxDesktop.loadEnterpriseAccount();
      const signedIn = Boolean(account.ok && account.loggedIn);
      setLoggedIn(signedIn);
      if (!signedIn) {
        setProjects([]);
        setListError("");
        return;
      }
    } catch {
      setLoggedIn(false);
      setProjects([]);
      return;
    }
    try {
      const listed = await window.agenticxDesktop.collabProjectList();
      if (!listed.ok) {
        if (listed.error === "enterprise-login-required") {
          setLoggedIn(false);
          setProjects([]);
          setListError("");
          return;
        }
        setListError(listed.error ?? t("createFailed"));
        return;
      }
      setListError("");
      setProjects(
        (listed.data?.projects ?? []).map((project) => ({
          id: project.id,
          name: project.name,
          instructions: project.instructions,
          created_at: project.created_at,
        })),
      );
    } catch (err) {
      setListError(err instanceof Error ? err.message : t("createFailed"));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    const onChanged = () => {
      void refresh();
    };
    window.addEventListener("agenticx:spaces:changed", onChanged);
    const off = window.agenticxDesktop?.onEnterpriseAccountChanged?.(() => {
      void refresh();
    });
    return () => {
      window.removeEventListener("agenticx:spaces:changed", onChanged);
      off?.();
    };
  }, [refresh]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(q));
  }, [projects, query]);

  const openCreate = (instructions = "", templateId = "") => {
    setSeedInstructions(instructions);
    setSeedTemplateId(templateId);
    setDialogOpen(true);
  };

  return (
    <MainViewShell>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-text-strong">{t("title")}</h1>
          <p className="mt-1 text-[13px] text-text-muted">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-bg-hover,var(--ui-btn-primary-bg))]"
          onClick={() => openCreate()}
        >
          {t("new")}
        </button>
      </div>

      {!loggedIn ? (
        <div className="mt-6 rounded-xl border border-border bg-surface-card p-4">
          <p className="text-[13px] text-text-primary">{t("needLogin")}</p>
          <button
            type="button"
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-hover"
            onClick={() => openSettings("account")}
          >
            {t("signIn")}
          </button>
        </div>
      ) : (
        <section className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-text-strong">{t("mine")}</h2>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              className="w-[220px] max-w-full rounded-md border border-border bg-surface-card px-2 py-1 text-[12px] text-text-primary outline-none placeholder:text-text-faint"
            />
          </div>
          {listError ? <p className="mt-2 text-[12px] text-rose-400">{listError}</p> : null}
          {visible.length === 0 ? (
            <p className="mt-3 text-[13px] text-text-faint">{t("empty")}</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((project) => {
                const when = relativeAdded(project.created_at, i18n.language);
                return (
                  <div key={project.id} className="relative rounded-xl border border-border bg-surface-card p-4">
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 pr-6 text-left"
                      onClick={() => openProject(project.id)}
                    >
                      <Waypoints className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" strokeWidth={1.75} />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-text-strong">
                          {project.name}
                        </span>
                        {when ? (
                          <span className="mt-1 block text-[12px] text-text-faint">
                            {t("added", { when })}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <HoverTip label={t("more")}>
                      <button
                        type="button"
                        aria-label={t("more")}
                        className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-strong"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </button>
                    </HoverTip>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <button
        type="button"
        className="mt-8 flex w-full items-center gap-3 rounded-xl border border-border bg-surface-card p-4 text-left hover:bg-surface-hover"
        onClick={() => setMainView("groups")}
      >
        <Waypoints className="h-5 w-5 shrink-0 text-text-muted" strokeWidth={1.75} />
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-text-strong">{t("localGroups")}</span>
          <span className="mt-1 block text-[12px] text-text-muted">{t("localGroupsHint")}</span>
        </span>
      </button>

      <section className="mt-8">
        <h2 className="text-[15px] font-semibold text-text-strong">{t("fromTemplate")}</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GROUP_TEMPLATES.map((template) => {
            const Icon = TEMPLATE_ICONS[template.id] ?? Waypoints;
            const name = tSidebar(groupTemplateI18nKey(template.id, "name"));
            const description = tSidebar(groupTemplateI18nKey(template.id, "description"));
            return (
              <button
                key={template.id}
                type="button"
                className="flex items-start gap-3 rounded-xl border border-border bg-surface-card p-4 text-left hover:bg-surface-hover"
                onClick={() => openCreate(description, template.id)}
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" strokeWidth={1.75} />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-text-strong">{name}</span>
                  <span className="mt-1 block text-[12px] text-text-muted">{description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <NewProjectDialog
        open={dialogOpen}
        initialInstructions={seedInstructions}
        initialTemplateId={seedTemplateId}
        onClose={() => setDialogOpen(false)}
        onCreated={(projectId) => {
          setDialogOpen(false);
          openProject(projectId);
          void refresh();
        }}
      />
    </MainViewShell>
  );
}
