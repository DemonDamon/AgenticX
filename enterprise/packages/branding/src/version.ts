/** Enterprise platform semver label for shell chrome (e.g. `v0.2.1`). */
export function getEnterpriseVersionLabel(): string {
  const raw = process.env.NEXT_PUBLIC_ENTERPRISE_VERSION?.trim();
  if (!raw) return "v0.0.0";
  return raw.startsWith("v") ? raw : `v${raw}`;
}
