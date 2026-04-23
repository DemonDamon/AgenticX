"use client";

import { LocaleProvider } from "@agenticx/ui";
import type { ReactNode } from "react";

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  return <LocaleProvider>{children}</LocaleProvider>;
}

