// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyAppearanceDocument, presetAppearance, type AppearanceDocument } from "../../../../shared/chat-appearance";
import { i18n } from "../../../i18n/i18n";
import { useAppearanceStore } from "../../../appearance/store";
import { useAppStore } from "../../../store";
import { ChatAppearanceSettings, type AppearanceEditorHandle } from "./ChatAppearanceSettings";
let saved: AppearanceDocument;
let saveError = "";
beforeEach(async () => {
  saved = emptyAppearanceDocument(); saveError = "";
  await i18n.changeLanguage("zh");
  useAppStore.setState({ theme: "dark", avatars: [], groups: [] });
  useAppearanceStore.setState({ document: saved, loaded: true, error: "", warning: "", previewActive: false, gpuUnavailable: true });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(window, "agenticxDesktop", { configurable: true, value: {
    loadChatAppearance: vi.fn(async () => ({ ok: true, value: saved })),
    saveChatAppearance: vi.fn(async ({ appearance }: { appearance: AppearanceDocument["global"] }) => {
      if (saveError) return { ok: false, error: saveError };
      saved = { ...saved, revision: saved.revision + 1, global: appearance };
      return { ok: true, value: saved };
    }),
    importChatAppearancePackage: vi.fn(async () => ({ ok: true, value: { appearance: presetAppearance("dusk"), assets: [] } })),
  } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("chat appearance editor", () => {
  it("previews without changing saved appearance, cancels, then applies", async () => {
    render(<ChatAppearanceSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "森林" }));
    expect(useAppearanceStore.getState().document.global.presetId).toBe("default");
    expect(screen.getByRole("button", { name: "森林" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: "默认" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "雾蓝" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await screen.findByText("外观已应用"); expect(saved.global.presetId).toBe("mist");
  });
  it("keeps edits and exposes the actual save error", async () => {
    saveError = "disk full";
    render(<ChatAppearanceSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "森林" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("disk full");
    expect(screen.getByRole("button", { name: "森林" }).getAttribute("aria-pressed")).toBe("true");
    expect(saved.global.presetId).toBe("default");
  });
  it("imports into a draft and guards leaving without applying", async () => {
    const ref = createRef<AppearanceEditorHandle>(); const leave = vi.fn();
    render(<ChatAppearanceSettings ref={ref} />);
    fireEvent.click(await screen.findByRole("button", { name: "导入主题" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "暮紫" }).getAttribute("aria-pressed")).toBe("true"));
    expect(saved.global.presetId).toBe("default");
    const parent = document.createElement("button"); parent.onclick = () => ref.current?.requestLeave(leave); document.body.append(parent);
    fireEvent.click(parent); await screen.findByText("放弃未应用的外观修改？");
    expect(leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" })); expect(leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" })); fireEvent.click(parent);
    expect(leave).toHaveBeenCalledOnce(); parent.remove();
  });
});

describe("background effect editor", () => {
  it("edits only the current variant and keeps effect parameters in the draft until applying", async () => {
    render(<ChatAppearanceSettings />);
    const background = await screen.findByRole("combobox", { name: "聊天背景" });
    fireEvent.change(background, { target: { value: "shader" } });
    fireEvent.click(await screen.findByRole("button", { name: "柔雾噪声" }));
    expect(saved.global.variants.dark.wallpaper.type).toBe("default");
    const scale = within(screen.getByRole("group", { name: "噪声尺度" })).getByRole("slider");
    fireEvent.change(scale, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    await screen.findByText("外观已应用");
    expect(saved.global.variants.dark.wallpaper.effect).toMatchObject({ id: "noise", params: { scale: 3 } });
    expect(saved.global.variants.light.wallpaper.type).toBe("default");
    expect(saved.global.variants.dark.bubbles.custom).toBe(false);
  });
  it("resets only effect parameters and defaults cursor playback to continuous", async () => {
    render(<ChatAppearanceSettings />);
    fireEvent.change(await screen.findByRole("combobox", { name: "聊天背景" }), { target: { value: "shader" } });
    fireEvent.click(await screen.findByRole("button", { name: "鼠标涟漪" }));
    expect((screen.getByRole("combobox", { name: "背景动效" }) as HTMLSelectElement).value).toBe("continuous");
    const strength = () => within(screen.getByRole("group", { name: "涟漪强度" })).getByRole("slider") as HTMLInputElement;
    fireEvent.change(strength(), { target: { value: "6" } });
    fireEvent.change(screen.getByRole("combobox", { name: "背景动效" }), { target: { value: "off" } });
    fireEvent.click(screen.getByRole("button", { name: "重置效果参数" }));
    expect(strength().value).toBe("2");
    expect((screen.getByRole("combobox", { name: "背景动效" }) as HTMLSelectElement).value).toBe("off");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect((screen.getByRole("combobox", { name: "聊天背景" }) as HTMLSelectElement).value).toBe("default");
  });
});


describe("motion preview navigation", () => {
  it("brings the preview into view and distinguishes continuous playback from send bursts", async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    render(<ChatAppearanceSettings />);
    fireEvent.change(await screen.findByRole("combobox", { name: "聊天背景" }), { target: { value: "shader" } });
    fireEvent.click(screen.getByRole("button", { name: "柔雾噪声" }));
    expect((screen.getByRole("combobox", { name: "背景动效" }) as HTMLSelectElement).value).toBe("continuous");
    fireEvent.change(screen.getByRole("combobox", { name: "背景动效" }), { target: { value: "on-send" } });
    fireEvent.click(screen.getByRole("button", { name: "预览发送效果" }));
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    fireEvent.change(screen.getByRole("combobox", { name: "背景动效" }), { target: { value: "continuous" } });
    fireEvent.click(screen.getByRole("button", { name: "查看动态预览" }));
    expect(scroll).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByRole("combobox", { name: "背景动效" }), { target: { value: "off" } });
    expect((screen.getByRole("button", { name: "查看动态预览" }) as HTMLButtonElement).disabled).toBe(true);
    expect(saved.global.variants.dark.wallpaper.type).toBe("default");
  });
});
