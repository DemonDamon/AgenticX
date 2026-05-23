import { useTranslations } from "next-intl";

/** @deprecated Prefer `useTranslations("portal")` directly in new code. */
export function usePortalCopy() {
  return useTranslations("portal");
}
