/** Client-side session expiry handling for admin-console API calls. */

/** 401 跳转登录进行中；并行 fetch 被导航中止时不应冒泡 Failed to fetch。 */
let sessionRedirecting = false;

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

function hangForever(): Promise<Response> {
  return new Promise<Response>(() => {});
}

function beginSessionRedirect(): void {
  if (sessionRedirecting) return;
  sessionRedirecting = true;
  redirectToAdminLogin();
}

/**
 * Drop-in fetch wrapper: on 401, redirect to /login and hang (avoid error toasts).
 * Parallel requests (e.g. dashboard Promise.all) must not surface "Failed to fetch"
 * when navigation aborts sibling in-flight fetches after the first 401.
 */
export async function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (sessionRedirecting) {
    return hangForever();
  }
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    if (sessionRedirecting) {
      return hangForever();
    }
    throw err;
  }
  if (res.status === 401) {
    beginSessionRedirect();
    return hangForever();
  }
  return res;
}
