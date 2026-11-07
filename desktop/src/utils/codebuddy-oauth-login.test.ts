import { describe, expect, it, vi } from "vitest";

import {
  codebuddyOAuthTerminalStatus,
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
});
