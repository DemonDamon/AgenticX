import type { NextConfig } from "next";

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
};

export default config;
