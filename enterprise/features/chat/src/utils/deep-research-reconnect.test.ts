import { describe, expect, it } from "vitest";
import {
  abortAllDeepResearchReconnects,
  abortDeepResearchReconnect,
  countActiveDeepResearchReconnects,
  startDeepResearchReconnect,
} from "./deep-research-reconnect";

/** Long-lived stream that only closes when the caller aborts (mirrors real fetch). */
function hangingFetch(): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const signal = init?.signal;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener("abort", () => {
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
    });
    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("startDeepResearchReconnect", () => {
  it("同一 runId 重复重连会顶替旧流，任何时刻只有一条活跃流", async () => {
    abortAllDeepResearchReconnects();
    const first = startDeepResearchReconnect("run-1", { onEvent: () => {} }, hangingFetch());
    await new Promise((r) => setTimeout(r, 10));
    expect(countActiveDeepResearchReconnects()).toBe(1);

    const second = startDeepResearchReconnect("run-1", { onEvent: () => {} }, hangingFetch());
    await new Promise((r) => setTimeout(r, 10));
    expect(countActiveDeepResearchReconnects()).toBe(1);

    // 旧流被顶替后自然收尾；最新流由 abortAll 统一停掉。
    await expect(first).resolves.toBeUndefined();
    abortAllDeepResearchReconnects();
    await expect(second).resolves.toBeUndefined();
    expect(countActiveDeepResearchReconnects()).toBe(0);
  });

  it("abortDeepResearchReconnect 只停指定 run，且是幂等的", async () => {
    abortAllDeepResearchReconnects();
    const a = startDeepResearchReconnect("run-a", { onEvent: () => {} }, hangingFetch());
    const b = startDeepResearchReconnect("run-b", { onEvent: () => {} }, hangingFetch());
    await new Promise((r) => setTimeout(r, 10));
    expect(countActiveDeepResearchReconnects()).toBe(2);

    abortDeepResearchReconnect("run-a");
    abortDeepResearchReconnect("run-a");
    await expect(a).resolves.toBeUndefined();
    expect(countActiveDeepResearchReconnects()).toBe(1);

    abortAllDeepResearchReconnects();
    await expect(b).resolves.toBeUndefined();
    expect(countActiveDeepResearchReconnects()).toBe(0);
  });

  it("非 abort 的流错误仍然上抛（不吞真实故障）", async () => {
    abortAllDeepResearchReconnects();
    const failingFetch = (async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    await expect(
      startDeepResearchReconnect("run-err", { onEvent: () => {} }, failingFetch),
    ).rejects.toThrow("HTTP 500");
    expect(countActiveDeepResearchReconnects()).toBe(0);
  });
});
