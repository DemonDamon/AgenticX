/** Client-side session expiry handling for admin-console API calls. */

export function safeAdminNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/dashboard";
  }
  return raw;
}

export function redirectToAdminLogin(nextPath?: string): void {
  if (typeof window === "undefined") return;
  const next = nextPath ?? `${window.location.pathname}${window.location.search}`;
  const url = `/login?next=${encodeURIComponent(next)}`;
  window.location.replace(url);
}

/**
 * Drop-in fetch wrapper: on 401, redirect to /login and hang (avoid error toasts).
 */
export async function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    redirectToAdminLogin();
    return new Promise<Response>(() => {});
  }
  return res;
}
