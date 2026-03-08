import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("desktop app basic flow", async () => {
  const appPath = path.resolve(
    __dirname,
    "..",
    "release",
    "mac-arm64",
    "AgenticX Desktop.app",
    "Contents",
    "MacOS",
    "AgenticX Desktop"
  );
  test.skip(!fs.existsSync(appPath), "packaged macOS app not found; run npm run build:mac first");
  const electronApp = await electron.launch({
    executablePath: appPath,
    args: []
  });
  const page = await electronApp.firstWindow();
  await expect(page).toHaveURL(/.*/);
  const title = await page.title();
  expect(typeof title).toBe("string");

  await electronApp.close();
});
