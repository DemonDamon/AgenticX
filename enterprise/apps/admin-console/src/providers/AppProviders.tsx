"use client";

import { LocaleProvider, type UiLocale } from "@agenticx/ui";
import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";

type AppProvidersProps = {
  children: ReactNode;
  initialLocale?: UiLocale;
};

export function AppProviders({ children, initialLocale = "zh" }: AppProvidersProps) {
  const router = useRouter();
  const onLocaleChange = useCallback(() => {
    router.refresh();
  }, [router]);

  return (
    <LocaleProvider initialLocale={initialLocale} onLocaleChange={onLocaleChange}>
      {children}
    </LocaleProvider>
  );
}
