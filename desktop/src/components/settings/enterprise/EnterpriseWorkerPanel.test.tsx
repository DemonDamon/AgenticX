/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "../../../i18n/i18n";
import { useAppStore } from "../../../store";
import { EnterpriseWorkerPanel } from "./EnterpriseWorkerPanel";

const studioFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../../../utils/studio-fetch", () => ({
  studioFetch: (...args: unknown[]) => studioFetchMock(...args),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const RUNNING = {
  enabled: true,
  running: true,
  ma_enabled: true,
  ma_environments: [{ id: "W1", name: "研发桌面" }],
  ma_work: [
    {
      work_id: "work-1",
      session_id: "sess-1",
      agent_id: "01JAGENTX",
      agent_version: 3,
      environment_id: "W1",
      started_at: "2026-10-26T08:00:00Z",
      workdir: "~/.agenticx/sessions/sess-1/work",
      interactive: false,
    },
  ],
  agents: [{ displayName: "旧助手" }],
  last_heartbeat_at: "2026-10-26T08:00:05Z",
  last_error: "上游超时",
};

describe("EnterpriseWorkerPanel", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    useAppStore.setState({ apiToken: "tok" });
    studioFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders environments and running work", async () => {
    studioFetchMock.mockResolvedValue(jsonResponse(RUNNING));
    render(<EnterpriseWorkerPanel />);
    expect(await screen.findByText("研发桌面")).toBeTruthy();
    expect(screen.getByText("01JAGENTv3")).toBeTruthy();
    expect(screen.getByText("企业分派")).toBeTruthy();
    expect(screen.getByText("~/.agenticx/sessions/sess-1/work")).toBeTruthy();
    expect(screen.getByText(/上游超时/)).toBeTruthy();
  });

  it("toggle accept switch is optimistic and rolls back on failure", async () => {
    let resolvePut: (response: Response) => void = () => undefined;
    studioFetchMock.mockImplementation(async (_path: string, init?: { method?: string }) => {
      if (init?.method === "PUT") {
        return new Promise<Response>((resolve) => {
          resolvePut = resolve;
        });
      }
      return jsonResponse({ enabled: false, running: false, ma_enabled: false });
    });
    render(<EnterpriseWorkerPanel />);
    const accept = await screen.findByRole("switch", { name: "让这台电脑承接企业智能体任务" });
    expect(accept.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(accept);
    await waitFor(() => {
      expect(accept.getAttribute("aria-checked")).toBe("true");
    });
    resolvePut(jsonResponse({ enabled: false }, 500));
    expect(await screen.findByText("保存失败（500）")).toBeTruthy();
    await waitFor(() => {
      expect(accept.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("toggle ma switch sends ma_enabled", async () => {
    studioFetchMock.mockImplementation(async (_path: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") {
        return jsonResponse({ enabled: false, running: false, ma_enabled: true, ma_environments: [] });
      }
      return jsonResponse({ enabled: false, running: false, ma_enabled: false });
    });
    render(<EnterpriseWorkerPanel />);
    const ma = await screen.findByRole("switch", { name: "承接托管智能体任务" });
    fireEvent.click(ma);
    await waitFor(() => {
      const put = studioFetchMock.mock.calls.find((call) => (call[1] as { method?: string } | undefined)?.method === "PUT");
      expect(put).toBeTruthy();
      expect(JSON.parse(String((put?.[1] as { body?: string }).body))).toEqual({ ma_enabled: true });
    });
  });

  it("uses SettingsSwitch", async () => {
    studioFetchMock.mockResolvedValue(jsonResponse({ enabled: false, running: false }));
    render(<EnterpriseWorkerPanel />);
    expect(await screen.findAllByRole("switch")).toHaveLength(2);
  });
});
