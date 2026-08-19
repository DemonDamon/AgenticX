const DEFAULT_CHAT_TURN_LIMIT = 3;
const GLOBAL_STATE_KEY = "__agenticxPortalChatConcurrencyV1";

type ChatConcurrencyState = {
  activeByPrincipal: Map<string, number>;
};

type GlobalWithChatConcurrency = typeof globalThis & {
  [GLOBAL_STATE_KEY]?: ChatConcurrencyState;
};

export type ChatTurnPrincipal = {
  tenantId: string;
  userId: string;
};

export type ChatTurnLease = {
  readonly released: boolean;
  release(): void;
};

function concurrencyState(): ChatConcurrencyState {
  const scope = globalThis as GlobalWithChatConcurrency;
  scope[GLOBAL_STATE_KEY] ??= { activeByPrincipal: new Map() };
  return scope[GLOBAL_STATE_KEY];
}

function principalKey(principal: ChatTurnPrincipal): string {
  return `${principal.tenantId}\u0000${principal.userId}`;
}

/**
 * Process-local admission for top-level Portal chat turns.
 *
 * Desktop and Portal deliberately do not share capacity. A future distributed
 * implementation can replace this module without changing route ownership.
 */
export function tryAcquireChatTurn(
  principal: ChatTurnPrincipal,
  limit = DEFAULT_CHAT_TURN_LIMIT,
): ChatTurnLease | null {
  const state = concurrencyState();
  const key = principalKey(principal);
  const active = state.activeByPrincipal.get(key) ?? 0;
  if (active >= limit) return null;

  state.activeByPrincipal.set(key, active + 1);
  let released = false;
  return {
    get released() {
      return released;
    },
    release() {
      if (released) return;
      released = true;
      const current = state.activeByPrincipal.get(key) ?? 0;
      if (current <= 1) state.activeByPrincipal.delete(key);
      else state.activeByPrincipal.set(key, current - 1);
    },
  };
}

export function chatConcurrencyLimitResponse(
  limit = DEFAULT_CHAT_TURN_LIMIT,
): Response {
  return Response.json(
    {
      error: {
        code: "42903",
        message: `当前已有 ${limit} 个任务正在运行，请等待其中一个完成后再试。`,
        limit,
      },
    },
    {
      status: 429,
      headers: {
        "retry-after": "2",
        "x-agenticx-concurrency-limit": String(limit),
      },
    },
  );
}

/** Transfer a lease to a response body and release it at its terminal edge. */
export function holdChatTurnUntilResponseEnds(
  response: Response,
  lease: ChatTurnLease,
): Response {
  if (!response.body) {
    lease.release();
    return response;
  }

  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          lease.release();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        lease.release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      lease.release();
      try {
        await reader.cancel(reason);
      } catch {
        // The lease is already released; upstream cancellation is best-effort.
      }
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Visible for deterministic unit tests only. */
export function resetChatConcurrencyForTests(): void {
  concurrencyState().activeByPrincipal.clear();
}

export const CHAT_TURN_CONCURRENCY_LIMIT = DEFAULT_CHAT_TURN_LIMIT;
