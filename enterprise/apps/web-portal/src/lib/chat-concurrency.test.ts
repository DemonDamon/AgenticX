import { beforeEach, describe, expect, it } from "vitest";
import {
  chatConcurrencyLimitResponse,
  holdChatTurnUntilResponseEnds,
  resetChatConcurrencyForTests,
  tryAcquireChatTurn,
} from "./chat-concurrency";

const principal = { tenantId: "tenant-1", userId: "user-1" };

describe("Portal chat concurrency", () => {
  beforeEach(() => resetChatConcurrencyForTests());

  it("allows three turns per tenant and user and rejects the fourth", () => {
    const leases = [
      tryAcquireChatTurn(principal),
      tryAcquireChatTurn(principal),
      tryAcquireChatTurn(principal),
    ];
    expect(leases.every(Boolean)).toBe(true);
    expect(tryAcquireChatTurn(principal)).toBeNull();

    leases[0]!.release();
    expect(tryAcquireChatTurn(principal)).not.toBeNull();
  });

  it("isolates capacity by both tenant and user", () => {
    for (let index = 0; index < 3; index += 1) {
      expect(tryAcquireChatTurn(principal)).not.toBeNull();
    }
    expect(tryAcquireChatTurn({ ...principal, userId: "user-2" })).not.toBeNull();
    expect(tryAcquireChatTurn({ ...principal, tenantId: "tenant-2" })).not.toBeNull();
  });

  it("releases only when a response reaches EOF", async () => {
    const lease = tryAcquireChatTurn(principal)!;
    const held = holdChatTurnUntilResponseEnds(new Response("complete"), lease);

    expect(lease.released).toBe(false);
    expect(await held.text()).toBe("complete");
    expect(lease.released).toBe(true);
  });

  it("releases on response cancellation and stream errors", async () => {
    const cancelLease = tryAcquireChatTurn(principal)!;
    const neverEnding = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => undefined);
      },
    });
    const cancelled = holdChatTurnUntilResponseEnds(new Response(neverEnding), cancelLease);
    await cancelled.body!.cancel("client disconnected");
    expect(cancelLease.released).toBe(true);

    const errorLease = tryAcquireChatTurn(principal)!;
    const failed = holdChatTurnUntilResponseEnds(
      new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            throw new Error("stream failed");
          },
        }),
      ),
      errorLease,
    );
    await expect(failed.text()).rejects.toThrow("stream failed");
    expect(errorLease.released).toBe(true);
  });

  it("returns the stable 429 contract", async () => {
    const response = chatConcurrencyLimitResponse();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "42903",
        message: "当前已有 3 个任务正在运行，请等待其中一个完成后再试。",
        limit: 3,
      },
    });
  });
});
