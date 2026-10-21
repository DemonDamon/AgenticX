import { modelPrefillsThinkTag } from "@agenticx/config";

type Event = {
  choices?: Array<{ delta?: { content?: string; tool_calls?: unknown }; finish_reason?: string | null }>;
  agenticx_usage?: Record<string, unknown>;
  error?: unknown;
};

async function* events(response: Response, signal: AbortSignal): AsyncGenerator<Event | string> {
  const reader = response.body!.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (pending.length > 1_000_000) throw new Error("模型流式响应过长，请重试。");
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0 || (done && pending.length > 0)) {
        const line = newline >= 0 ? pending.slice(0, newline).trim() : pending.trim();
        pending = newline >= 0 ? pending.slice(newline + 1) : "";
        if (line.startsWith(":")) { yield line; continue; }
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        yield JSON.parse(data) as Event;
      }
      if (done) throw new Error("模型连接提前中断，请重试。");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Each reasoning phase is a separately billed gateway call when the endpoint has no native thinking budget. */
export function localThinkingBudgetFetch(
  model: { id: string; route: string } | null,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    if (model?.route !== "local" || !modelPrefillsThinkTag(model.id) || typeof init?.body !== "string") {
      return fetchImpl(input, init);
    }
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const budget = body.thinking_token_budget;
    if (!Number.isInteger(budget) || Number(budget) < 0) return fetchImpl(input, init);
    if (process.env.AGENTICX_LOCAL_THINKING_BUDGET_MODE === "native") return fetchImpl(input, init);
    const { thinking_token_budget: _budget, ...plain } = body;
    const template = plain.chat_template_kwargs as Record<string, unknown> | undefined;
    if (plain.stream !== true || template?.enable_thinking === false || plain.enable_thinking === false) {
      return fetchImpl(input, { ...init, body: JSON.stringify(plain) });
    }
    const cap = Number(plain.max_completion_tokens ?? plain.max_tokens) || 32768;
    const thinkingCap = Math.min(Number(budget), Math.floor(cap / 2));
    const abort = new AbortController();
    const cancel = () => abort.abort();
    init.signal?.addEventListener("abort", cancel, { once: true });
    if (init.signal?.aborted) cancel();
    const call = (payload: Record<string, unknown>, stage: string) => {
      const headers = new Headers(init.headers);
      headers.set("x-agenticx-trace-stage", `${headers.get("x-agenticx-trace-stage") ?? "chat"}.${stage}`);
      return fetchImpl(input, { ...init, headers: Object.fromEntries(headers), signal: abort.signal, body: JSON.stringify(payload) });
    };
    const continuation = (raw: string) => {
      let prefix = raw.startsWith("<think>") ? raw : `<think>${raw}`;
      if (!prefix.includes("</think>")) prefix += "\n</think>\n";
      const { max_completion_tokens: _max, ...rest } = plain;
      return { ...rest, max_tokens: Math.max(1, cap - thinkingCap),
        messages: [...(plain.messages as unknown[]), { role: "assistant", content: prefix }],
        continue_final_message: true, add_generation_prompt: false };
    };
    const { max_completion_tokens: _max, ...firstBody } = plain;
    let first: Response;
    try {
      first = await call(thinkingCap === 0 ? continuation("") : { ...firstBody, max_tokens: thinkingCap },
        thinkingCap === 0 ? "final" : "thinking");
    } catch (error) {
      init.signal?.removeEventListener("abort", cancel);
      throw error;
    }
    if (!first.ok || !first.body || !first.headers.get("content-type")?.includes("text/event-stream")) {
      init.signal?.removeEventListener("abort", cancel);
      return first;
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: Event | string) => {
          if (!abort.signal.aborted) controller.enqueue(encoder.encode(
            typeof event === "string" ? `${event}\n\n` : `data: ${JSON.stringify(event)}\n\n`,
          ));
        };
        let raw = "";
        let ending: Event | undefined;
        let usage: Record<string, unknown> | undefined;
        let failed = false;
        let toolCall = false;
        try {
          if (thinkingCap === 0) emit({ choices: [{ delta: { content: "</think>\n" } }] });
          for await (const event of events(first, abort.signal)) {
            if (typeof event === "string") { emit(event); continue; }
            const choice = event.choices?.[0];
            raw += choice?.delta?.content ?? "";
            toolCall ||= Boolean(choice?.delta?.tool_calls);
            failed ||= Boolean(event.error);
            if (event.agenticx_usage) { usage = event.agenticx_usage; continue; }
            if (choice?.finish_reason && thinkingCap > 0) {
              ending = event;
              emit({ ...event, choices: event.choices?.map((c) => ({ ...c, finish_reason: null })) });
            } else emit(event);
          }
          const finish = ending?.choices?.[0]?.finish_reason;
          const answer = raw.includes("</think>") ? raw.slice(raw.indexOf("</think>") + 8).trim() : "";
          if (!abort.signal.aborted && thinkingCap > 0 && !failed && !toolCall && (finish === "length" || (finish === "stop" && !answer))) {
            if (!raw.includes("</think>")) emit({ choices: [{ delta: { content: "\n</think>\n" } }] });
            const final = await call(continuation(raw), "final");
            if (!final.ok || !final.body) {
              const error = await final.json().catch(() => null) as { error?: unknown } | null;
              emit({ error: error?.error ?? { code: "50006", message: "正文续写失败，请重试。" } });
            } else {
              for await (const event of events(final, abort.signal)) {
                if (typeof event === "string") { emit(event); continue; }
                if (event.agenticx_usage) {
                  const combined = { ...event.agenticx_usage };
                  for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
                    combined[key] = Number(usage?.[key] ?? 0) + Number(combined[key] ?? 0);
                  }
                  usage = combined;
                } else emit(event);
              }
            }
          } else if (ending) emit(ending);
          if (usage) emit({ agenticx_usage: usage });
        } catch (error) {
          if (!abort.signal.aborted) emit({ error: { code: "50006", message: error instanceof Error ? error.message : "正文续写失败，请重试。" } });
        } finally {
          init.signal?.removeEventListener("abort", cancel);
          if (!abort.signal.aborted) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
          try { controller.close(); } catch { /* The consumer may have cancelled. */ }
        }
      },
      cancel,
    });
    const headers = new Headers(first.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(stream, { status: first.status, headers });
  };
}
