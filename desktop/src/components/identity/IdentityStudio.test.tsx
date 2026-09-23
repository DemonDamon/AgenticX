/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import {
  buildStudioSvgDataUri,
  defaultRecipe,
  stylePreviewDataUri,
  type IdentityStudioRecipe,
} from "../../utils/identity-studio";
import { IdentityStudio } from "./IdentityStudio";

function Harness({ initial = "阿来" }: { initial?: string }) {
  const [nickname, setNickname] = useState(initial);
  const [recipe, setRecipe] = useState<IdentityStudioRecipe>(() => defaultRecipe(initial));
  return (
    <IdentityStudio
      nickname={nickname}
      onNicknameChange={setNickname}
      recipe={recipe}
      onRecipeChange={setRecipe}
      onUploadFile={() => {}}
    />
  );
}

describe("IdentityStudio", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("redraws the preview after the nickname debounce", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const before = screen.getByTestId("studio-preview").getAttribute("src");
    fireEvent.change(screen.getByRole("textbox", { name: "怎么称呼你" }), {
      target: { value: "北北" },
    });
    act(() => {
      vi.advanceTimersByTime(160);
    });
    const after = screen.getByTestId("studio-preview").getAttribute("src");
    expect(after).toBe(buildStudioSvgDataUri(defaultRecipe("北北")));
    expect(after).not.toBe(before);
  });

  it("switches the whole portrait when a style is chosen", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "插画" }));
    expect(screen.getByRole("button", { name: "插画" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("studio-preview").getAttribute("src")).toBe(
      buildStudioSvgDataUri({
        ...defaultRecipe("阿来"),
        style: "lorelei-neutral",
        options: { glasses: false, freckles: false, background: "light" },
      }),
    );
  });

  it("shuffles only the seed", () => {
    render(<Harness />);
    const before = screen.getByTestId("studio-preview").getAttribute("src");
    fireEvent.click(screen.getByRole("button", { name: "换一张" }));
    expect((screen.getByRole("textbox", { name: "怎么称呼你" }) as HTMLInputElement).value).toBe("阿来");
    expect(screen.getByRole("button", { name: "线稿" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("studio-preview").getAttribute("src")).not.toBe(before);
  });

  it("shows at most three tweak chips and keeps style-rail previews on Felix", () => {
    vi.useFakeTimers();
    render(<Harness />);
    expect(document.querySelectorAll("[data-studio-tweak]").length).toBe(3);
    const railSrc = () =>
      screen.getByRole("button", { name: "线稿" }).querySelector("img")?.getAttribute("src");
    expect(railSrc()).toBe(stylePreviewDataUri("notionists-neutral"));
    fireEvent.change(screen.getByRole("textbox", { name: "怎么称呼你" }), {
      target: { value: "北北" },
    });
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(railSrc()).toBe(stylePreviewDataUri("notionists-neutral"));
  });
});
