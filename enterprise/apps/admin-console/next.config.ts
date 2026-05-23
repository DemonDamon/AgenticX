import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
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
};

export default withNextIntl(config);
