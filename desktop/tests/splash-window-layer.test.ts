import { describe, expect, it } from "vitest";

import {
  buildSplashMouseIgnoreOptions,
  buildSplashWindowLayerOptions,
  focusSplashIfOpen,
} from "../electron/splash";

describe("splash window layer", () => {
  it("does not pin the startup splash above other desktop apps", () => {
    expect(buildSplashWindowLayerOptions()).toEqual({ alwaysOnTop: false });
  });

  it("lets clicks pass through the glass so the app underneath can come forward", () => {
    expect(buildSplashMouseIgnoreOptions()).toEqual({ ignore: true, forward: true });
    expect(buildSplashMouseIgnoreOptions({ fading: true })).toEqual({
      ignore: true,
      forward: true,
    });
  });

  it("keeps clicks on the splash only when an interactive control needs them", () => {
    expect(buildSplashMouseIgnoreOptions({ captureClicks: true })).toEqual({ ignore: false });
  });

  it("does not focus a splash that was never created", () => {
    expect(focusSplashIfOpen()).toBe(false);
  });
});
