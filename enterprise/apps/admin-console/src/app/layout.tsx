import type { ReactNode } from "react";
import { RootShell } from "../components/RootShell";
import { AppProviders } from "../providers/AppProviders";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-[var(--machi-bg)] text-zinc-100 antialiased">
        <AppProviders>
          <RootShell>{children}</RootShell>
        </AppProviders>
      </body>
    </html>
  );
}

export const metadata = {
  title: "AgenticX Enterprise · admin-console",
};
