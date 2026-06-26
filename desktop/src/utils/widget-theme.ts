/** CSS custom properties forwarded into sandboxed HTML widget iframes. */
const WIDGET_THEME_VAR_NAMES = [
  "--text-primary",
  "--text-strong",
  "--text-muted",
  "--text-subtle",
  "--text-faint",
  "--surface-base",
  "--surface-card",
  "--surface-card-strong",
  "--border-subtle",
  "--border-strong",
  "--theme-color-rgb",
  "--theme-color-text",
  "--status-success",
  "--status-warning",
  "--status-error",
] as const;

/**
 * Collect Near theme CSS variables from the host document for iframe srcdoc injection.
 * Returns a semicolon-separated `:root` declaration string (without wrapping braces).
 */
export function collectThemeCssVars(): string {
  if (typeof document === "undefined") return "";
  const styles = getComputedStyle(document.documentElement);
  const bodyFont = getComputedStyle(document.body).fontFamily;
  const parts: string[] = [];
  if (bodyFont) {
    parts.push(`--font-sans: ${bodyFont}`);
  }
  for (const name of WIDGET_THEME_VAR_NAMES) {
    const value = styles.getPropertyValue(name).trim();
    if (value) {
      parts.push(`${name}: ${value}`);
    }
  }
  return parts.join("; ");
}

/** Variable names exposed to the model via system prompt (SVG/HTML authoring). */
export const WIDGET_THEME_VAR_HINTS = WIDGET_THEME_VAR_NAMES;
