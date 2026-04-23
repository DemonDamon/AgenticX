import type { ReactNode } from "react";
import { AppProviders } from "../providers/AppProviders";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

export const metadata = {
  title: "AgenticX Enterprise · web-portal",
};
