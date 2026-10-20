import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

function internalToken(): string {
  const direct = process.env.GATEWAY_INTERNAL_TOKEN?.trim();
  if (direct) return direct;
  const file = process.env.GATEWAY_INTERNAL_TOKEN_FILE?.trim();
  if (!file) return "";
  try { return readFileSync(file, "utf8").trim(); }
  catch { return ""; }
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const row = part as { type?: unknown; text?: unknown };
      return row.type === "text" && typeof row.text === "string" ? row.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function hasMultimodalContent(messages: unknown[]): boolean {
  return messages.some((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return false;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return false;
    return content.some((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return false;
      const type = (part as { type?: unknown }).type;
      return typeof type === "string" && type !== "text";
    });
  });
}

function originalTextCandidates(messages: unknown[]): string[] {
  const users = messages
    .map((message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return null;
      const row = message as { role?: unknown; content?: unknown };
      if (row.role !== "user") return null;
      const text = contentText(row.content).trim();
      return text || null;
    })
    .filter((item): item is string => item != null);
  const systemText = messages
    .map((message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return "";
      const row = message as { role?: unknown; content?: unknown };
      return row.role === "system" ? contentText(row.content) : "";
    })
    .join("\n");
  if (
    users.length === 1 &&
    (systemText.includes("研究规划助手") || systemText.includes("调研开题助手"))
  ) {
    // These prompts contain the complete original input. User-written markers
    // must never truncate it before hashing.
    return [users[0]!];
  }

  // No source boundary proves that the final user turn is generated evidence.
  // Treat every user-bucket message as original input until that contract exists.
  return users.length > 1 ? [users.join("\n\n")] : [];
}

function userTextHash(messages: unknown[]): string | undefined {
  const [candidate] = originalTextCandidates(messages);
  return candidate
    ? createHash("sha256").update(candidate).digest("hex")
    : undefined;
}

export function publicRetrievalFetch(
  fetchImpl: typeof fetch,
  gatewayUrl: string,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = internalToken();
    const target = input instanceof Request ? input.url : input.toString();
    if (target !== gatewayUrl || !token || typeof init?.body !== "string") return fetchImpl(input, init);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(init.body) as Record<string, unknown>; }
    catch { return fetchImpl(input, init); }
    if (!parsed || typeof parsed.model !== "string" || !Array.isArray(parsed.messages)) return fetchImpl(input, init);
    if (hasMultimodalContent(parsed.messages)) return fetchImpl(input, init);
    const hash = userTextHash(parsed.messages);
    if (!hash) return fetchImpl(input, init);
    const body = JSON.stringify({
      ...parsed,
      __policy_context: {
        source: "public-retrieval",
        ...(hash ? { user_text_sha256: hash } : {}),
      },
    });
    const headers = new Headers(init.headers);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const signature = createHmac("sha256", token)
      .update(`public-retrieval-v2\n${headers.get("authorization") ?? ""}\n${timestamp}\n${nonce}\n`)
      .update(body)
      .digest("hex");
    headers.set("x-agenticx-policy-timestamp", timestamp);
    headers.set("x-agenticx-policy-nonce", nonce);
    headers.set("x-agenticx-policy-signature", signature);
    return fetchImpl(input, { ...init, headers, body });
  }) as typeof fetch;
}
