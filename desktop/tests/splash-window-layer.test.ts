import { describe, expect, it } from "vitest";

import { buildSplashWindowLayerOptions, focusSplashIfOpen } from "../electron/splash";

describe("splash window layer", () => {
  it("does not pin the startup splash above other desktop apps", () => {
    expect(buildSplashWindowLayerOptions()).toEqual({ alwaysOnTop: false });
  });

  it("does not focus a splash that was never created", () => {
    expect(focusSplashIfOpen()).toBe(false);
  });
});
