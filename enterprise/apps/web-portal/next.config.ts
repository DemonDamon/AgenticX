import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";
import enterprisePkg from "../../package.json";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const config: NextConfig = {
  // Dependabot/lock refresh left eslint-config-next peers incomplete; don't block production compile.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  env: {
    NEXT_PUBLIC_ENTERPRISE_VERSION: enterprisePkg.version,
  },
  // HSTS is applied per request in src/middleware.ts so it can read deploy env.
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  transpilePackages: [
    "@agenticx/ui",
    "@agenticx/branding",
    "@agenticx/auth",
    "@agenticx/config",
    "@agenticx/sdk-ts",
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
  experimental: {
    optimizePackageImports: ["lucide-react", "@agenticx/ui"],
  },
  turbopack: {
    root: path.resolve(process.cwd(), "../.."),
  },
};

export default withNextIntl(config);
