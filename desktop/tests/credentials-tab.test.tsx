/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../src/i18n/i18n";
import { useAppStore } from "../src/store";
import { CredentialsTab } from "../src/components/settings/credentials/CredentialsTab";

const { studioFetchMock } = vi.hoisted(() => ({
  studioFetchMock: vi.fn(),
}));

vi.mock("../src/utils/studio-fetch", () => ({
  studioFetch: (...args: unknown[]) => studioFetchMock(...args),
}));

const SECRET = "super-secret-value";

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function listedCredential() {
  return {
    name: "TEST_TOKEN",
    description: "测试用",
    updated_at: "2026-10-14T04:00:00Z",
    referenced_by: ["mcp:demo", "provider:local"],
    value: SECRET,
  };
}

describe("CredentialsTab", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    useAppStore.setState({ apiBase: "http://studio.test", apiToken: "tok" });
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    studioFetchMock.mockReset();
    studioFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (path === "/api/credentials" && method === "GET") {
        return okJson({ ok: true, credentials: [listedCredential()] });
      }
      if (method === "PUT" || method === "DELETE") {
        return okJson({ ok: true });
      }
      return {
        ok: false,
        status: 500,
        statusText: "Error",
        json: async () => ({ detail: "unexpected" }),
        text: async () => "unexpected",
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the credential list and never shows the saved secret", async () => {
    render(<CredentialsTab />);
    expect(await screen.findByText("TEST_TOKEN")).toBeTruthy();
    expect(screen.getByText(/测试用/)).toBeTruthy();
    expect(screen.getByText(/MCP · demo/)).toBeTruthy();
    expect(screen.getByText(/模型 · local/)).toBeTruthy();
    expect(screen.getByText(/引用位置/)).toBeTruthy();
    expect(screen.getByText(/更新时间/)).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain(SECRET);
  });

  it("disables save and shows a hint when the name is invalid", async () => {
    render(<CredentialsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "添加凭证" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "not_valid" } });
    fireEvent.change(screen.getByLabelText("值"), { target: { value: "secret" } });
    expect(screen.getByText("名称须以大写字母开头，只能包含大写字母、数字和下划线，长度为 2 到 64 位。")).toBeTruthy();
    const save = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("omits value when an edit leaves the secret blank", async () => {
    render(<CredentialsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const secret = screen.getByLabelText("值") as HTMLInputElement;
    expect(secret.type).toBe("password");
    expect(secret.value).toBe("");
    expect(secret.placeholder).toBe("留空则保持原值");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      const put = studioFetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PUT");
      expect(put).toBeTruthy();
    });
    const put = studioFetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PUT");
    const init = put?.[1] as RequestInit;
    expect(String(put?.[0])).toBe("/api/credentials/TEST_TOKEN");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("value");
    expect(body.description).toBe("测试用");
    expect(document.body.textContent ?? "").not.toContain(SECRET);
  });

  it("copies the credential reference to the clipboard", async () => {
    render(<CredentialsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "复制引用" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("${cred:TEST_TOKEN}");
    });
    expect(await screen.findByText("已复制")).toBeTruthy();
  });

  it("keeps the dialog open and shows the api error when save fails", async () => {
    studioFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (path === "/api/credentials" && method === "GET") {
        return okJson({ ok: true, credentials: [] });
      }
      if (method === "PUT") {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          json: async () => ({ detail: "value is required when creating a credential" }),
          text: async () => "",
        };
      }
      return okJson({ ok: true });
    });
    render(<CredentialsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "添加凭证" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "MY_TOKEN" } });
    fireEvent.change(screen.getByLabelText("值"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("value is required when creating a credential")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "添加凭证" })).toBeTruthy();
  });

  it("confirms deletion in the app and names the settings that reference it", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CredentialsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(
      screen.getByText("以下配置引用了它，删除后这些配置会连接失败：MCP · demo、模型 · local"),
    ).toBeTruthy();
    confirmSpy.mockRestore();
  });
});
