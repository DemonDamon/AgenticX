import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGraphRun,
  listGraphRunsForSession,
  postGraphIntervene,
} from "./useGraphRun";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authorized graph API client", () => {
  it("binds detail and list reads to the active session and group", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          run: {
            run_id: "gr-1",
            session_id: "session one",
            group_id: "group/one",
            status: "open",
            version: 1,
            nodes: {},
            edges: [],
          },
          projection: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runs: [{ run_id: "gr-1", status: "open", version: 1 }] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await fetchGraphRun("http://studio", "token", "gr-1", "session one", "group/one");
    await listGraphRunsForSession("http://studio", "token", "session one", "group/one");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://studio/api/graph/runs/gr-1?session_id=session+one&group_id=group%2Fone",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://studio/api/graph/runs?session_id=session+one&group_id=group%2Fone",
    );
  });

  it("includes ownership in intervention bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, version: 4, warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postGraphIntervene(
      "http://studio",
      "token",
      "gr-1",
      {
        op: "pause",
        version: 3,
        node_ids: [],
        edge_ids: [],
        payload: { scope: "run" },
      },
      "session-1",
      "group-1",
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      session_id: "session-1",
      group_id: "group-1",
      op: "pause",
      version: 3,
    });
  });
});
