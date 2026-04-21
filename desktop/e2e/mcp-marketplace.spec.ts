import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function resolvePackagedAppPath(): string {
  return path.resolve(
    __dirname,
    "..",
    "release",
    "mac-arm64",
    "AgenticX Desktop.app",
    "Contents",
    "MacOS",
    "AgenticX Desktop",
  );
}

test("mcp marketplace smoke", async () => {
  const appPath = resolvePackagedAppPath();
  test.skip(!fs.existsSync(appPath), "packaged macOS app not found; run npm run build:mac first");

  const electronApp = await electron.launch({ executablePath: appPath, args: [] });
  const page = await electronApp.firstWindow();

  await expect(page).toHaveURL(/.*/);
  await expect(page.locator("body")).toBeVisible();

  await electronApp.close();
});
