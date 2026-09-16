import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyAwareFetch } from "../electron/proxy-fetch";

const SAVED = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED };
  vi.unstubAllGlobals();
});

describe("proxyAwareFetch", () => {
  it("proxyAwareFetch bypasses the proxy for loopback hosts", async () => {
    process.env.HTTPS_PROXY = "http://127.0.0.1:7890";
    const direct = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", direct);

    for (const url of [
      "http://127.0.0.1:3000/api/desktop/rooms",
      "http://localhost:3000/api/desktop/rooms",
    ]) {
      const res = await proxyAwareFetch(url);
      expect(res.status).toBe(200);
    }
    expect(direct).toHaveBeenCalledTimes(2);
  });

  it("proxyAwareFetch goes direct when no proxy is configured", async () => {
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;
    const direct = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", direct);

    await proxyAwareFetch("https://example.com/x");
    expect(direct).toHaveBeenCalledTimes(1);
  });
});
