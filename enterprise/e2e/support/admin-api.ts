type Cookie = { name: string; value: string };

type Envelope = {
  code?: string;
  message?: string;
  data?: unknown;
};

export type AdminResult = {
  status: number;
  body: Envelope;
};

/**
 * Admin route handlers authenticate the session cookie.
 * The console client (`adminFetch`) does not send a CSRF header, so neither does this helper.
 */
export async function adminRequest(
  baseUrl: string,
  cookies: readonly Cookie[],
  path: string,
  init: RequestInit = {},
): Promise<AdminResult> {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '));
  if (init.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(new URL(path, baseUrl), { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as Envelope;
  return { status: response.status, body };
}

export function assertOk(result: AdminResult, action: string): void {
  if (result.status >= 400 || result.body.code !== '00000') {
    const message = result.body.message ?? '';
    throw new Error(`${action} failed: HTTP ${result.status} code ${result.body.code ?? 'none'} ${message}`.trim());
  }
}
