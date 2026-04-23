import type { CSSProperties } from "react";

type MinimalBrand = {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
};

function hslVar(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (!normalized) return `hsl(${fallback})`;
  if (normalized.startsWith("hsl(") || normalized.startsWith("#") || normalized.startsWith("rgb")) {
    return normalized;
  }
  return `hsl(${normalized})`;
}

export function buildBrandThemeVars(brand: MinimalBrand): CSSProperties {
  const vars: Record<string, string> = {
    "--ui-color-primary": hslVar(brand.primary_color, "262 83% 58%"),
    "--ui-color-secondary": hslVar(brand.secondary_color, "215 25% 27%"),
    "--ui-color-accent": hslVar(brand.accent_color, "262 50% 45%"),
  };
  return vars as CSSProperties;
}

