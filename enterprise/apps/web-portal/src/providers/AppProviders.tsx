"use client";

import type { ReactNode } from "react";

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  // theme/brand/auth provider 在 W2 接入真实实现；当前先保留统一入口
  return <>{children}</>;
}

