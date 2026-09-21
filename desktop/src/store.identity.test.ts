import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "./store";
import { BRAND_CUBE_COLORWAY_ID } from "./utils/cube-colorway";

describe("identity store", () => {
  afterEach(() => {
    useAppStore.getState().setUserAvatarUrl("");
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
});
