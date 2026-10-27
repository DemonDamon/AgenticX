/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "../i18n/i18n";
import type { Avatar } from "../store";
import { useAppStore } from "../store";
import { AvatarEnterprisePublishTab } from "./AvatarEnterprisePublishTab";
import { AvatarSettingsPanel } from "./AvatarSettingsPanel";

const studioFetch = vi.hoisted(() => vi.fn());

vi.mock("../utils/studio-fetch", () => ({
  studioFetch: (...args: unknown[]) => studioFetch(...args),
}));

const avatar: Avatar = {
  id: "av-1",
  name: "周报助手",
  role: "助手",
  avatarUrl: "",
  pinned: false,
  createdBy: "manual",
  defaultProvider: "deepseek",
  defaultModel: "deepseek-chat",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const previewReport = {
  model: "deepseek/deepseek-chat",
  included_tools: [
    { name: "bash_exec", policy: "always_ask" },
    { name: "file_read", policy: "always_allow" },
  ],
  disabled_tools: ["web_search"],
  excluded_tools: [],
  removed_credential_refs: ["GITHUB_TOKEN"],
  redacted_secrets: 1,
  replaced_local_paths: 2,
  warnings: ["本机技能不随版本发布"],
  errors: [] as string[],
};

function previewBody(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    dry_run: true,
    report: previewReport,
    ...overrides,
  };
}

function installDesktop(loggedIn: boolean) {
  window.agenticxDesktop = {
    loadEnterpriseAccount: vi.fn(async () => ({ ok: true, loggedIn })),
    onEnterpriseAccountChanged: vi.fn(() => () => undefined),
    getToolsStatus: vi.fn(async () => ({ ok: true, tools: [] })),
    loadAvatarSoul: vi.fn(async () => ({ ok: true, content: "" })),
    getApiBase: vi.fn(async () => "http://127.0.0.1:9"),
    getApiAuthToken: vi.fn(async () => "tok"),
    loadSkills: vi.fn(async () => ({ ok: true, items: [] })),
  } as unknown as typeof window.agenticxDesktop;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ brains: [] })),
  );
}

describe("AvatarEnterprisePublishTab", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    useAppStore.setState({ apiToken: "desktop-token" }); // gitleaks:allow
    studioFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads dry-run preview on mount", async () => {
    studioFetch.mockResolvedValue(jsonResponse(previewBody()));
    render(<AvatarEnterprisePublishTab avatarId="av-1" avatarName="周报助手" />);
    expect(await screen.findByText("deepseek/deepseek-chat")).toBeTruthy();
    expect(screen.getByText("每次询问")).toBeTruthy();
    expect(screen.getByText("已移除凭证引用：GITHUB_TOKEN")).toBeTruthy();
    expect(studioFetch).toHaveBeenCalledWith(
      "/api/avatars/av-1/enterprise-publish",
      expect.objectContaining({
        method: "POST",
        apiToken: "desktop-token", // gitleaks:allow
        body: JSON.stringify({ dry_run: true }),
      }),
    );
  });

  it("hides submit when report has errors", async () => {
    studioFetch.mockResolvedValue(
      jsonResponse(
        previewBody({
          ok: false,
          report: {
            ...previewReport,
            errors: ["请先在「基本信息」里为分身设置默认模型"],
          },
        }),
      ),
    );
    render(<AvatarEnterprisePublishTab avatarId="av-1" avatarName="周报助手" />);
    expect(await screen.findByText("请先在「基本信息」里为分身设置默认模型")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "提交到企业" })).toBeNull();
  });

  it("submits with note and shows draft result", async () => {
    studioFetch
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          dry_run: false,
          result: {
            version: 1,
            created: true,
            lifecycle: "draft",
            routing_mode: "follow_latest",
            effective_version: 1,
          },
        }),
      );
    render(<AvatarEnterprisePublishTab avatarId="av-1" avatarName="周报助手" />);
    const note = await screen.findByPlaceholderText("选填：这次改了什么");
    fireEvent.change(note, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "提交到企业" }));
    expect(await screen.findByText("已提交为草稿 v1，管理员发布后员工可见")).toBeTruthy();
    const submitCall = studioFetch.mock.calls[1];
    expect(JSON.parse(String(submitCall[1].body))).toEqual({ dry_run: false, note: "x" });
  });

  it("keeps panel and shows backend error on failure", async () => {
    studioFetch
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: false,
          message: "HTTP 409 · 该智能体已被管理员回收，无法再次提交",
        }),
      );
    render(<AvatarEnterprisePublishTab avatarId="av-1" avatarName="周报助手" />);
    const note = await screen.findByPlaceholderText("选填：这次改了什么");
    fireEvent.change(note, { target: { value: "第一次提交" } });
    fireEvent.click(screen.getByRole("button", { name: "提交到企业" }));
    expect(await screen.findByText("HTTP 409 · 该智能体已被管理员回收，无法再次提交")).toBeTruthy();
    expect((screen.getByPlaceholderText("选填：这次改了什么") as HTMLTextAreaElement).value).toBe(
      "第一次提交",
    );
  });

  it("shows unchanged message", async () => {
    studioFetch
      .mockResolvedValueOnce(jsonResponse(previewBody()))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          result: {
            version: 3,
            created: false,
            lifecycle: "published",
            routing_mode: "pinned",
            effective_version: 3,
          },
        }),
      );
    render(<AvatarEnterprisePublishTab avatarId="av-1" avatarName="周报助手" />);
    fireEvent.click(await screen.findByRole("button", { name: "提交到企业" }));
    expect(await screen.findByText("内容与企业侧最新版本 v3 一致，无需重复提交")).toBeTruthy();
  });

  it("only one primary button", async () => {
    studioFetch.mockResolvedValue(jsonResponse(previewBody()));
    render(<AvatarEnterprisePublishTab avatarId="av-1" avatarName="周报助手" />);
    await screen.findByRole("button", { name: "提交到企业" });
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("AvatarSettingsPanel enterprise tab", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  afterEach(() => {
    cleanup();
  });

  it("AvatarSettingsPanel shows enterprise tab only when logged in", async () => {
    installDesktop(false);
    const { unmount } = render(
      <AvatarSettingsPanel mode="avatar" avatar={avatar} onClose={() => undefined} onSaved={() => undefined} />,
    );
    await screen.findByRole("button", { name: "基本信息" });
    await waitFor(() => {
      expect(window.agenticxDesktop.loadEnterpriseAccount).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: "企业" })).toBeNull();
    unmount();

    installDesktop(true);
    render(
      <AvatarSettingsPanel mode="avatar" avatar={avatar} onClose={() => undefined} onSaved={() => undefined} />,
    );
    expect(await screen.findByRole("button", { name: "企业" })).toBeTruthy();
  });
});
