import type { ReactNode } from "react";
import type { Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AppProviders } from "../providers/AppProviders";
import { PageWatermark } from "../components/PageWatermark";
import "./globals.css";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const htmlLang = locale === "en" ? "en" : "zh-CN";

  return (
    <html lang={htmlLang} suppressHydrationWarning>
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
        <NextIntlClientProvider messages={messages}>
          <AppProviders initialLocale={locale === "en" ? "en" : "zh"}>
            <PageWatermark text={(process.env.NEXT_PUBLIC_PAGE_WATERMARK || "").trim() || "demo@agenticx.local"} />
            {children}
          </AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export const metadata = {
  title: "AgenticX Enterprise · web-portal",
  icons: {
    icon: [{ url: "/near-mark.png?v=2", type: "image/png", sizes: "256x256" }],
  },
};
