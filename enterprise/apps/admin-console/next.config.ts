import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";
import enterprisePkg from "../../package.json";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const navPrefetchEnabled =
  process.env.NODE_ENV === "production" ||
  process.env.npm_lifecycle_event !== "dev:webpack";

const config: NextConfig = {
  env: {
    NEXT_PUBLIC_ENTERPRISE_VERSION: enterprisePkg.version,
    NEXT_PUBLIC_ADMIN_NAV_PREFETCH: navPrefetchEnabled ? "1" : "0",
  },
  transpilePackages: [
    "@agenticx/ui",
    "@agenticx/branding",
    "@agenticx/auth",
    "@agenticx/config",
    "@agenticx/feature-chat",
    "@agenticx/feature-iam",
    "@agenticx/feature-model-service",
    "@agenticx/feature-knowledge-base",
    "@agenticx/feature-settings",
    "@agenticx/feature-metering",
    "@agenticx/feature-audit",
    "@agenticx/feature-policy",
    "@agenticx/feature-tools-mcp",
    "@agenticx/feature-agents",
  ],
  // Tree-shake large barrel packages; cuts dev compile time for routes that import a few icons/components.
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "@agenticx/ui",
      "@tanstack/react-table",
    ],
  },
  turbopack: {
    root: path.resolve(process.cwd(), "../.."),
  },
};

export default withNextIntl(config);
