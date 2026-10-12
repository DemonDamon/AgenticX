// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/i18n";
import { ApprovalInboxButton } from "./ApprovalInbox";

const store = {
  apiBase: "http://127.0.0.1:9",
  apiToken: "desktop-token",
};

vi.mock("../store", () => ({
  useAppStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

type Item = {
  request_id: string;
  session_id: string;
  agent_id: string;
  question: string;
  tool: string;
  risk: string;
  protected_reason: string;
  label: string;
  created_at: number;
  expires_at: number;
  remaining_seconds: number;
};

function item(overrides: Partial<Item> = {}): Item {
  return {
    request_id: "req-1",
    session_id: "sess-1",
    agent_id: "meta",
    question: "Allow this command?",
    tool: "bash_exec",
    risk: "high",
    protected_reason: "protected command",
    label: "",
    created_at: 1,
    expires_at: 2,
    remaining_seconds: 120,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function installFetch(items: Item[], confirm?: (init?: RequestInit) => Promise<Response> | Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/approvals/pending")) {
      return jsonResponse({ ok: true, items });
    }
    if (url.endsWith("/api/confirm") && confirm) {
      return confirm(init);
    }
    return new Response("missing", { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function t(key: string): string {
  return i18n.t(key, { ns: "sidebar" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ApprovalInboxButton", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  it("shows a numeric badge when approvals are waiting", async () => {
    installFetch([item({ request_id: "a" }), item({ request_id: "b", question: "Second?" })]);
    render(<ApprovalInboxButton />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("approvals.title") }).textContent).toContain("2");
    });
  });

  it("hides the badge and shows the empty state when nothing is waiting", async () => {
    const fetchMock = installFetch([]);
    render(<ApprovalInboxButton />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const button = screen.getByRole("button", { name: t("approvals.title") });
    expect(button.textContent ?? "").not.toMatch(/\d/);

    fireEvent.click(button);
    expect(screen.getByText(t("approvals.empty"))).toBeTruthy();
  });

  it("removes an item immediately and posts approval", async () => {
    const gate = deferred<Response>();
    const target = item({
      request_id: "req-42",
      session_id: "sess-42",
      agent_id: "avatar-7",
      question: "Push the branch?",
    });
    const fetchMock = installFetch([target], () => gate.promise);
    render(<ApprovalInboxButton />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("approvals.title") }).textContent).toContain("1");
    });
    fireEvent.click(screen.getByRole("button", { name: t("approvals.title") }));
    fireEvent.click(screen.getByRole("button", { name: t("approvals.approve") }));

    await waitFor(() => {
      expect(screen.queryByText("Push the branch?")).toBeNull();
    });

    const confirmCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/api/confirm"));
    expect(confirmCall).toBeTruthy();
    expect(String(confirmCall?.[0])).toBe("http://127.0.0.1:9/api/confirm");
    expect(confirmCall?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(confirmCall?.[1]?.body))).toEqual({
      session_id: "sess-42",
      request_id: "req-42",
      approved: true,
      agent_id: "avatar-7",
    });

    gate.resolve(jsonResponse({ ok: true }));
    await waitFor(() => {
      expect(screen.queryByText("Push the branch?")).toBeNull();
    });
  });

  it("restores the card and shows the failure under it when confirm returns 404", async () => {
    const gate = deferred<Response>();
    const target = item({ question: "Delete the archive?" });
    installFetch([target], () => gate.promise);
    render(<ApprovalInboxButton />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("approvals.title") }).textContent).toContain("1");
    });
    fireEvent.click(screen.getByRole("button", { name: t("approvals.title") }));
    fireEvent.click(screen.getByRole("button", { name: t("approvals.approve") }));

    await waitFor(() => {
      expect(screen.queryByText("Delete the archive?")).toBeNull();
    });

    gate.resolve(new Response("missing", { status: 404 }));
    await waitFor(() => {
      expect(screen.getByText("Delete the archive?")).toBeTruthy();
    });
    expect(screen.getByText(`${t("approvals.failed")} HTTP 404`)).toBeTruthy();
  });

  it("labels scheduled tasks and unattended runs from the item label", async () => {
    installFetch([
      item({
        request_id: "auto-1",
        label: "automation:atask_1",
        question: "Run the backup",
      }),
      item({
        request_id: "run-1",
        label: "",
        question: "Run the shell",
      }),
    ]);
    render(<ApprovalInboxButton />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("approvals.title") }).textContent).toContain("2");
    });
    fireEvent.click(screen.getByRole("button", { name: t("approvals.title") }));

    expect(screen.getByText(t("approvals.sourceAutomation"))).toBeTruthy();
    expect(screen.getByText(t("approvals.sourceUnattended"))).toBeTruthy();
    expect(screen.getByText("Run the backup")).toBeTruthy();
    expect(screen.getByText("Run the shell")).toBeTruthy();
  });
});
