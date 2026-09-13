import { i18n } from "../../../i18n/i18n";

function st(key: string): string {
  return String(i18n.t(key, { ns: "settings" }));
}

export const BRAIN_SCOPE_GLOBAL_BADGE =
  "bg-[var(--brain-scope-global-bg)] text-[var(--brain-scope-global-fg)] ring-1 ring-[var(--brain-scope-global-ring)]";

export const BRAIN_SCOPE_PRIVATE_BADGE =
  "bg-[var(--brain-scope-private-bg)] text-[var(--brain-scope-private-fg)] ring-1 ring-[var(--brain-scope-private-ring)]";

export function brainScopeBadge(scope: string): { label: string; className: string } {
  if (scope === "private") {
    return {
      label: st("brains.badgePrivate"),
      className: BRAIN_SCOPE_PRIVATE_BADGE,
    };
  }
  return {
    label: st("brains.badgeGlobal"),
    className: BRAIN_SCOPE_GLOBAL_BADGE,
  };
}

export function brainTypeShort(type: string): string {
  return type === "code" ? st("brains.typeShortCode") : st("brains.typeShortDocs");
}
