/**
 * Resolve the public OpenAI-compatible /v1 base URL for Near Desktop inference.
 * Never derive this from internal GATEWAY_COMPLETIONS_URL / docker service names.
 */

export type ResolveDesktopInferenceApiBaseInput = {
  configured?: string;
  nodeEnv?: string;
};

export type ResolveDesktopInferenceApiBaseResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function resolveDesktopInferenceApiBase(
  input: ResolveDesktopInferenceApiBaseInput,
): ResolveDesktopInferenceApiBaseResult {
  const nodeEnv = (input.nodeEnv ?? process.env.NODE_ENV ?? "development").trim();
  const raw = (input.configured ?? "").trim();

  if (!raw) {
    if (nodeEnv === "production") {
      return { ok: false, error: "NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL is required in production" };
    }
    return { ok: true, url: "http://127.0.0.1:8088/v1" };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL is not a valid URL" };
  }

  if (nodeEnv === "production") {
    const isHttps = parsed.protocol === "https:";
    const isHttpLoopback = parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname);
    if (!isHttps && !isHttpLoopback) {
      return {
        ok: false,
        error: "production inference base must use https (or http loopback for local smoke)",
      };
    }
  }

  let path = parsed.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/") {
    path = "/v1";
  } else if (!path.endsWith("/v1")) {
    path = `${path}/v1`;
  }

  const url = `${parsed.protocol}//${parsed.host}${path}`;
  return { ok: true, url };
}
