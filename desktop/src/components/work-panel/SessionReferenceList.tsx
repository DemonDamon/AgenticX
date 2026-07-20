/**
 * Trae-style「参考信息」list for WorkPanel summary tab.
 * Groups: 技能 / 联网搜索 / 知识库.
 *
 * Author: Damon Li
 */

import type { ReactNode } from "react";
import { BookOpen, Library } from "lucide-react";
import type { SessionReferenceBundle } from "../../utils/session-references";
import { openSearchReference } from "../../utils/open-kb-reference";
import type { SearchReference } from "../../types/search-references";
import { SiteFavicon } from "./SiteFavicon";

type Props = {
  bundle: SessionReferenceBundle;
  /** Prefer in-app WorkPanel browser for http(s) links when provided. */
  onOpenWebUrl?: (url: string, title: string) => void;
};

function RefRow({
  icon,
  label,
  title,
  onClick,
  muted,
}: {
  icon: ReactNode;
  label: string;
  title?: string;
  onClick?: () => void;
  muted?: boolean;
}) {
  const className = [
    "flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition",
    onClick ? "hover:bg-surface-hover/70 cursor-pointer" : "",
    muted ? "text-text-faint" : "text-text-strong",
  ]
    .filter(Boolean)
    .join(" ");

  if (onClick) {
    return (
      <button type="button" className={className} title={title || label} onClick={onClick}>
        <span className="shrink-0 text-text-faint">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
  }

  return (
    <div className={className} title={title || label}>
      <span className="shrink-0 text-text-faint">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  );
}

function SubHeader({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 mt-2 px-1.5 text-[11px] font-normal tracking-wide text-text-faint first:mt-0">
      {children}
    </div>
  );
}

function openWeb(ref: SearchReference, onOpenWebUrl?: Props["onOpenWebUrl"]) {
  const url = String(ref.url || "").trim();
  if (/^https?:\/\//i.test(url) && onOpenWebUrl) {
    onOpenWebUrl(url, ref.title || url);
    return;
  }
  openSearchReference(ref);
}

export function SessionReferenceList({ bundle, onOpenWebUrl }: Props) {
  if (bundle.isEmpty) return null;

  return (
    <div className="space-y-0.5">
      {bundle.skills.length > 0 ? (
        <div>
          <SubHeader>技能</SubHeader>
          <div className="space-y-0.5">
            {bundle.skills.map((skill) => (
              <RefRow
                key={`skill-${skill.name}`}
                icon={<BookOpen className="h-3.5 w-3.5 text-sky-500" strokeWidth={1.7} />}
                label={skill.name}
              />
            ))}
          </div>
        </div>
      ) : null}

      {bundle.webGroups.length > 0 ? (
        <div>
          <SubHeader>联网搜索</SubHeader>
          <div className="space-y-0.5">
            {bundle.webGroups.map((group) => {
              const ref = group.primary;
              const label = ref.title || ref.domain || ref.url;
              return (
                <RefRow
                  key={`web-${group.docKey}`}
                  icon={
                    <SiteFavicon
                      key={`favicon-${group.docKey}`}
                      url={ref.url}
                      domain={ref.domain}
                    />
                  }
                  label={label}
                  title={ref.url || label}
                  onClick={() => openWeb(ref, onOpenWebUrl)}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {bundle.kbGroups.length > 0 ? (
        <div>
          <SubHeader>知识库</SubHeader>
          <div className="space-y-0.5">
            {bundle.kbGroups.map((group) => {
              const ref = group.primary;
              return (
                <RefRow
                  key={`kb-${group.docKey}`}
                  icon={<Library className="h-3.5 w-3.5 text-violet-400" strokeWidth={1.7} />}
                  label={ref.title}
                  title={ref.kbSourcePath || ref.title}
                  onClick={() => openSearchReference(ref)}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
