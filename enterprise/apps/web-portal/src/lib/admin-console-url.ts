/**
 * Resolve the Admin Console entry URL from web-portal.
 *
 * Priority:
 * 1. Explicit build-time `NEXT_PUBLIC_ADMIN_CONSOLE_URL` (e.g. `https://admin.example.com`).
 * 2. Browser runtime derivation matching the deploy nginx independent-port layout:
 *    - Local dev port `:3000` -> `http(s)://<host>:3001`
 *    - Production HTTPS -> `https://<host>:8443`
 *    - Production HTTP -> `http://<host>:8081`
 * 3. Non-browser fallback -> `http://localhost:3001`
 */
export function resolveAdminConsoleUrl(
  configuredUrl: string | undefined = process.env.NEXT_PUBLIC_ADMIN_CONSOLE_URL,
  loc: Pick<Location, "protocol" | "hostname" | "port"> | undefined =
    typeof window !== "undefined" ? window.location : undefined,
): string {
  const trimmed = configuredUrl?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (loc) {
    const { protocol, hostname, port } = loc;
    if (port === "3000") {
      return `${protocol}//${hostname}:3001`;
    }
    const adminPort = protocol === "https:" ? "8443" : "8081";
    return `${protocol}//${hostname}:${adminPort}`;
  }
  return "http://localhost:3001";
}
