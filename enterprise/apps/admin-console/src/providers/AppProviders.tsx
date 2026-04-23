"use client";

import { LocaleProvider } from "@agenticx/ui";
import type { ReactNode } from "react";

export function AppProviders({ children }: { children: ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>;
}

