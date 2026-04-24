import type { ReactNode } from "react";
import { RootShell } from "../components/RootShell";
import { AppProviders } from "../providers/AppProviders";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var stored = localStorage.getItem('agenticx-ui-theme');
                  var resolved = stored === 'light' || stored === 'dark'
                    ? stored
                    : (stored === 'system' || !stored)
                      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
                      : 'dark';
                  if (resolved === 'dark') {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
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
