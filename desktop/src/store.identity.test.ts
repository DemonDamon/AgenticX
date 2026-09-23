import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "./store";
import { BRAND_CUBE_COLORWAY_ID } from "./utils/cube-colorway";
import { defaultRecipe } from "./utils/identity-studio";

describe("identity store", () => {
  afterEach(() => {
    useAppStore.getState().setUserAvatarStudio(null);
    useAppStore.getState().setUserAvatarUrl("");
    useAppStore.getState().setUserNickname("");
    useAppStore.getState().setIdentityStudioSeen(false);
    useAppStore.getState().setUserCubeColorwayId(BRAND_CUBE_COLORWAY_ID);
    useAppStore.getState().setMetaAvatarUrl("");
  });

  it("keeps an uploaded user photo when the cube colorway changes", () => {
    const photo = "data:image/png;base64,aaa";
    useAppStore.getState().setUserAvatarUrl(photo);
    useAppStore.getState().setUserCubeColorwayId("matcha-lid");
    expect(useAppStore.getState().userAvatarUrl).toBe(photo);
    expect(useAppStore.getState().userCubeColorwayId).toBe("matcha-lid");
    expect(useAppStore.getState().metaAvatarUrl).toContain("data:image/svg+xml");
  });

  it("commits a studio portrait without letting a cube colorway replace it", () => {
    useAppStore.getState().commitStudioAvatar(defaultRecipe("阿来"), "阿来");
    const portrait = useAppStore.getState().userAvatarUrl;
    expect(portrait.startsWith("data:image/svg+xml")).toBe(true);
    expect(useAppStore.getState().userAvatarStudio?.source).toBe("studio");
    expect(useAppStore.getState().identityStudioSeen).toBe(true);
    useAppStore.getState().setUserCubeColorwayId("matcha-lid");
    expect(useAppStore.getState().userAvatarUrl).toBe(portrait);
  });

  it("rebuilds an unfrozen studio portrait when the nickname changes", () => {
    useAppStore.getState().commitStudioAvatar(defaultRecipe("阿来"), "阿来");
    const before = useAppStore.getState().userAvatarUrl;
    useAppStore.getState().setUserNickname("北北");
    const after = useAppStore.getState().userAvatarUrl;
    expect(after.startsWith("data:image/svg+xml")).toBe(true);
    expect(after).not.toBe(before);
    expect(useAppStore.getState().userAvatarStudio?.seed).toBe("北北");
  });

  it("keeps a frozen studio portrait when the nickname changes", () => {
    useAppStore.getState().commitStudioAvatar(
      { ...defaultRecipe("阿来"), seed: "studio-frozen", seedFrozen: true },
      "阿来",
    );
    const before = useAppStore.getState().userAvatarUrl;
    useAppStore.getState().setUserNickname("北北");
    expect(useAppStore.getState().userNickname).toBe("北北");
    expect(useAppStore.getState().userAvatarUrl).toBe(before);
    expect(useAppStore.getState().userAvatarStudio?.seed).toBe("studio-frozen");
  });
});
