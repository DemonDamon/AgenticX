import { z } from "zod";

export const BrandCoreSchema = z.object({
  name: z.string().min(1),
  short_name: z.string().min(1),
  slogan: z.string().default(""),
  logo: z.string().default("./assets/logo.svg"),
  favicon: z.string().default("./assets/favicon.ico"),
  primary_color: z.string().default("262 83% 58%"),
  secondary_color: z.string().default("215 25% 27%"),
  accent_color: z.string().default("262 50% 45%"),
});

export const CopyrightSchema = z.object({
  company: z.string().min(1),
  year: z.number().int().min(2000).max(3000),
  icp: z.string().default(""),
});

export const LegalSchema = z.object({
  privacy_url: z.string().min(1),
  terms_url: z.string().min(1),
});

export const ComplianceSchema = z.object({
  pipl_notice: z.boolean().default(true),
  enable_user_consent: z.boolean().default(true),
});

export const BrandConfigSchema = z.object({
  brand: BrandCoreSchema,
  copyright: CopyrightSchema,
  legal: LegalSchema,
  compliance: ComplianceSchema,
});

export type BrandConfig = z.infer<typeof BrandConfigSchema>;

export const FeatureFlagsSchema = z.record(z.string(), z.boolean());
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

export const BrandYamlSchema = z.object({
  brand: BrandCoreSchema.partial().optional(),
  copyright: CopyrightSchema.partial().optional(),
  legal: LegalSchema.partial().optional(),
  compliance: ComplianceSchema.partial().optional(),
});

export const FeatureYamlSchema = z.object({
  features: FeatureFlagsSchema,
});

export const DEFAULT_BRAND_CONFIG: BrandConfig = {
  brand: {
    name: "AgenticX Enterprise",
    short_name: "AgenticX",
    slogan: "Enterprise AI workspace",
    logo: "./assets/logo.svg",
    favicon: "./assets/favicon.ico",
    primary_color: "262 83% 58%",
    secondary_color: "215 25% 27%",
    accent_color: "262 50% 45%",
  },
  copyright: {
    company: "AgenticX",
    year: 2026,
    icp: "",
  },
  legal: {
    privacy_url: "/legal/privacy",
    terms_url: "/legal/terms",
  },
  compliance: {
    pipl_notice: true,
    enable_user_consent: true,
  },
};

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  chat: true,
  "chat.web_search": true,
  "chat.multi_round": true,
  "gateway.policy_engine": true,
};

