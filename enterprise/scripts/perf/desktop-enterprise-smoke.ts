/**
 * Desktop → Gateway direct managed inference smoke.
 *
 * Env (required for live run):
 *   PORTAL_BASE_URL
 *   GATEWAY_PUBLIC_BASE_URL
 *   DESKTOP_TEST_EMAIL
 *   DESKTOP_TEST_PASSWORD
 *
 * Never prints password or PAT plaintext.
 *
 * Usage:
 *   pnpm exec tsx enterprise/scripts/perf/desktop-enterprise-smoke.ts
 */

type Json = Record<string, unknown>;

function requireEnv(name: string): string {
  const v = String(process.env[name] ?? "").trim();
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function maskPat(token: string): string {
  if (!token.startsWith("agx-pat-")) return "agx-pat-***";
  return `agx-pat-***${token.slice(-4)}`;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function readJson(res: Response): Promise<Json> {
  return (await res.json().catch(() => ({}))) as Json;
}

async function main(): Promise<void> {
  const missing = ["PORTAL_BASE_URL", "GATEWAY_PUBLIC_BASE_URL", "DESKTOP_TEST_EMAIL", "DESKTOP_TEST_PASSWORD"].filter(
    (k) => !String(process.env[k] ?? "").trim(),
  );
  if (missing.length) {
    console.log(
      JSON.stringify({
        ok: false,
        skipped: true,
        reason: "missing env for live smoke",
        missing,
      }),
    );
    process.exit(0);
  }

  const portal = stripSlash(requireEnv("PORTAL_BASE_URL"));
  const gatewayPublic = stripSlash(requireEnv("GATEWAY_PUBLIC_BASE_URL"));
  const email = requireEnv("DESKTOP_TEST_EMAIL");
  const password = requireEnv("DESKTOP_TEST_PASSWORD");

  const tokenResp = await fetch(`${portal}/api/desktop/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, password, deviceName: "smoke" }),
  });
  const tokenJson = await readJson(tokenResp);
  const data = (tokenJson.data ?? {}) as Json;
  const token = String(data.token ?? "");
  if (!tokenResp.ok || !token.startsWith("agx-pat-")) {
    throw new Error(`token issue failed HTTP ${tokenResp.status}`);
  }
  console.log(`[smoke] pat=${maskPat(token)}`);

  // Non-interactive browser-device protocol checks (no user approve in CI).
  const initResp = await fetch(`${portal}/api/desktop/auth/device/init`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ deviceName: "smoke-device" }),
  });
  const initJson = await readJson(initResp);
  const initData = (initJson.data ?? {}) as Json;
  const deviceId = String(initData.deviceId ?? "");
  const deviceSecret = String(initData.deviceSecret ?? "");
  const verificationUrl = String(initData.verificationUrl ?? "");
  if (!initResp.ok || !deviceId || !deviceSecret || !verificationUrl.includes("/auth/desktop?device=")) {
    throw new Error(`device init failed HTTP ${initResp.status}`);
  }
  const portalUrl = new URL(portal);
  const verifyUrl = new URL(verificationUrl);
  const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const sameOrigin =
    portalUrl.origin === verifyUrl.origin ||
    (portalUrl.protocol === verifyUrl.protocol &&
      portalUrl.port === verifyUrl.port &&
      loopback.has(portalUrl.hostname) &&
      loopback.has(verifyUrl.hostname));
  if (!sameOrigin || !verifyUrl.pathname.startsWith("/auth/desktop")) {
    throw new Error("verificationUrl must be same-origin with portal");
  }
  const badPoll = await fetch(`${portal}/api/desktop/auth/device/poll`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ deviceId, deviceSecret: "definitely-wrong-secret" }),
  });
  if (badPoll.status !== 401) {
    throw new Error(`expected 401 for bad device secret, got ${badPoll.status}`);
  }
  const cancelResp = await fetch(`${portal}/api/desktop/auth/device/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ deviceId, deviceSecret }),
  });
  if (!cancelResp.ok) {
    throw new Error(`device cancel failed HTTP ${cancelResp.status}`);
  }
  console.log(JSON.stringify({ ok: true, scenario: "device-auth-init-cancel" }));

  const bootResp = await fetch(`${portal}/api/desktop/bootstrap`, {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
  });
  const bootJson = await readJson(bootResp);
  const boot = (bootJson.data ?? {}) as Json;
  if (!bootResp.ok) {
    throw new Error(`bootstrap failed HTTP ${bootResp.status}`);
  }
  const inferenceBase = String(boot.inferenceApiBaseUrl ?? "").replace(/\/+$/, "");
  const models = Array.isArray(boot.models) ? (boot.models as Array<{ id?: string }>) : [];
  const modelId = String(models[0]?.id ?? "").trim();
  if (!inferenceBase || !modelId) {
    throw new Error("bootstrap missing inferenceApiBaseUrl or models");
  }
  if (!inferenceBase.startsWith(gatewayPublic) && inferenceBase !== `${gatewayPublic}/v1`) {
    // Allow either origin or origin/v1; do not print full URLs with customer host — print shape only.
    console.log(`[smoke] inferenceTransport=${String(boot.inferenceTransport ?? "")}`);
  } else {
    console.log(`[smoke] inferenceTransport=${String(boot.inferenceTransport ?? "gateway-direct-v1")}`);
  }

  const helloStarted = Date.now();
  const chatResp = await fetch(`${inferenceBase}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: modelId,
      stream: true,
      reasoning_split: true,
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  if (!chatResp.ok) {
    throw new Error(`gateway stream hello failed HTTP ${chatResp.status}`);
  }
  const reader = chatResp.body?.getReader();
  if (!reader) throw new Error("missing stream body");
  const decoder = new TextDecoder();
  let firstByteMs = -1;
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteMs < 0) firstByteMs = Date.now() - helloStarted;
    buf += decoder.decode(value, { stream: true });
    if (buf.includes("[DONE]")) break;
  }
  const completeMs = Date.now() - helloStarted;
  console.log(
    JSON.stringify({
      ok: true,
      scenario: "stream-hello",
      firstByteMs,
      completeMs,
      modelAssigned: Boolean(modelId),
    }),
  );

  // Unassigned model → expect 403
  const denyResp = await fetch(`${inferenceBase}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: "provider-not-assigned/model-x",
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  if (denyResp.status !== 403) {
    throw new Error(`expected 403 for unassigned model, got ${denyResp.status}`);
  }
  console.log(JSON.stringify({ ok: true, scenario: "unassigned-model-403" }));

  // Conflicting provider header → 400
  const conflictResp = await fetch(`${inferenceBase}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-agenticx-provider": "evil-provider",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  if (conflictResp.status !== 400) {
    throw new Error(`expected 400 for header conflict, got ${conflictResp.status}`);
  }
  console.log(JSON.stringify({ ok: true, scenario: "header-conflict-400" }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
  process.exit(1);
});
