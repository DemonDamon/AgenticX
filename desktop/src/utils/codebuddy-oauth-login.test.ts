import { describe, expect, it, vi } from "vitest";

import {
  codebuddyOAuthTerminalStatus,
  refreshCodebuddyHarnessAfterOAuth,
  waitForCodebuddyOAuth,
} from "./codebuddy-oauth-login";

describe("codebuddy oauth login", () => {
  it("never treats in-progress statuses as terminal", () => {
    expect(codebuddyOAuthTerminalStatus("starting")).toBe(false);
    expect(codebuddyOAuthTerminalStatus("authorizing")).toBe(false);
    expect(codebuddyOAuthTerminalStatus("success")).toBe(true);
    expect(codebuddyOAuthTerminalStatus("failed")).toBe(true);
  });

  it("opens authorize url once and completes on success", async () => {
    const openAuthorizeUrl = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          job_id: "j1",
          status: "authorizing",
          authorize_url: "https://copilot.tencent.com/oauth/start",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          job_id: "j1",
          status: "success",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const snap = await waitForCodebuddyOAuth({
      apiBase: "http://127.0.0.1:9",
      apiToken: "t",
      jobId: "j1",
      openAuthorizeUrl,
      pollIntervalMs: 1,
    });
    expect(snap.status).toBe("success");
    expect(openAuthorizeUrl).toHaveBeenCalledTimes(1);
    expect(openAuthorizeUrl.mock.calls[0][0]).toContain("tencent.com");
    vi.unstubAllGlobals();
  });

  it("posts refresh-harness after oauth with studio session id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        stopped_surface_ids: ["surf-1"],
        refreshed_binding: true,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await refreshCodebuddyHarnessAfterOAuth({
      apiBase: "http://127.0.0.1:9",
      apiToken: "tok",
      sessionId: "sess-abc",
    });
    expect(out.ok).toBe(true);
    expect(out.refreshed_binding).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/codebuddy/oauth/refresh-harness");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ session_id: "sess-abc" });
    vi.unstubAllGlobals();
  });
});
