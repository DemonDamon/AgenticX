import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium, webkit, type Page } from "playwright";

const enterprise = fileURLToPath(new URL("../../", import.meta.url));
const config = JSON.parse(await readFile(path.join(enterprise, "tsconfig.base.json"), "utf8"));
const alias = Object.fromEntries(Object.entries(config.compilerOptions.paths as Record<string, string[]>)
  .filter(([key]) => !key.includes("*"))
  .map(([key, paths]) => [key, path.resolve(enterprise, paths[0]!)]));
const engine = process.env.PORTAL_VIEWPORT_BROWSER ?? "chromium";
assert(engine === "chromium" || engine === "webkit", "Unknown browser engine");
const output = path.resolve(process.env.PORTAL_VIEWPORT_ARTIFACTS ?? path.join(tmpdir(), "portal-viewport-artifacts"), engine);
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: path.join(enterprise, "features/chat/test-browser"),
  resolve: { alias: { ...alias, tailwindcss: path.join(enterprise, "apps/web-portal/node_modules/tailwindcss/index.css") } },
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: path.join(enterprise, "apps/web-portal") },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [enterprise] } },
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
});
const browser = await ({ chromium, webkit }[engine]).launch({ headless: true });
const failures: string[] = [];
const results: string[] = [];
let activePage: Page | undefined;
try {
  await server.listen();
  const address = server.httpServer?.address();
  assert(address && typeof address === "object");
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  activePage = page;
  page.on("pageerror", (error) => failures.push(error.message));
  await page.addInitScript(() => {
    const visual = Object.assign(new EventTarget(), {
      width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0, scale: 1,
    });
    const viewport = { segments: null as Array<{ left: number; top: number; width: number; height: number }> | null };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: visual });
    Object.defineProperty(window, "viewport", { configurable: true, value: viewport });
    Object.assign(window, {
      __setTestViewport(snapshot: Partial<typeof visual> & { segments?: typeof viewport.segments }) {
        const { segments, ...geometry } = snapshot;
        Object.assign(visual, geometry);
        if ("segments" in snapshot) viewport.segments = segments ?? null;
        visual.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("resize"));
      },
    });
  });
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle" });
  const frame = page.getByTestId("viewport-frame");
  const composer = page.getByTestId("composer");
  const change = async (snapshot: Record<string, unknown>) => {
    await page.evaluate((value) => {
      (window as unknown as { __setTestViewport: (value: Record<string, unknown>) => void }).__setTestViewport(value);
    }, snapshot);
    await page.waitForFunction(() => !document.querySelector("[data-testid=viewport-frame]")?.getAttribute("style")?.includes("NaN"));
    await page.waitForTimeout(400); // Covers the production observer's bounded settle timers.
  };
  const fit = async (expected: { left?: number; top?: number; width: number; height: number }) => {
    const bounds = await frame.boundingBox(); const input = await composer.boundingBox();
    assert(bounds && input);
    assert(Math.abs(bounds.width - expected.width) < 1, `Unexpected frame width ${bounds.width}`);
    assert(Math.abs(bounds.height - expected.height) < 1, `Unexpected frame height ${bounds.height}`);
    if (expected.left !== undefined) assert(Math.abs(bounds.x - expected.left) < 1);
    if (expected.top !== undefined) assert(Math.abs(bounds.y - expected.top) < 1);
    assert(input.y >= bounds.y - 1 && input.y + input.height <= bounds.y + bounds.height + 1, "Composer outside usable frame");
    return bounds;
  };
  const capture = async (name: string) => {
    await page.screenshot({ path: path.join(output, `${name}.png`) }); results.push(name);
  };
  const resize = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await change({ width, height, offsetLeft: 0, offsetTop: 0, scale: 1, segments: null });
  };

  await fit({ left: 0, top: 0, width: 390, height: 844 });
  await capture("phone-chat");
  await page.getByRole("textbox", { name: "Message" }).focus();
  const scrollBefore = await page.getByTestId("reader").evaluate((element) => { element.scrollTop = 600; return element.scrollTop; });
  await page.getByRole("textbox").evaluate((element) => {
    (element as HTMLTextAreaElement).setSelectionRange(2, 5);
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  });
  await change({ height: 390, offsetTop: 40 });
  await fit({ left: 0, top: 40, width: 390, height: 390 });
  assert.equal(await page.getByTestId("reader").evaluate((element) => element.scrollTop), scrollBefore);
  assert.deepEqual(await page.getByRole("textbox").evaluate((element) => {
    const input = element as HTMLTextAreaElement;
    return [input.selectionStart, input.selectionEnd, document.activeElement === input];
  }), [2, 5, true]);
  await capture("phone-keyboard");
  await change({ scale: 2, width: 195, height: 195 });
  await fit({ left: 0, top: 40, width: 390, height: 390 }); results.push("pinch-preserves-layout");
  await page.getByRole("textbox").dispatchEvent("compositionend");
  await resize(1366, 1024);
  await change({ height: 460, offsetTop: 70 });
  await fit({ left: 0, top: 70, width: 1366, height: 460 });
  await capture("wide-keyboard");
  await resize(1200, 800);
  await page.getByRole("textbox").blur();
  await change({ segments: [{ left: 0, top: 0, width: 580, height: 800 }, { left: 620, top: 0, width: 580, height: 800 }] });
  const vertical = await fit({ width: 580, height: 800 });
  assert(vertical.x === 0 || vertical.x === 620);
  const menuBox = await page.getByTestId("compact-menu").boundingBox();
  const titleBox = await page.getByTestId("chat-title").boundingBox();
  assert(menuBox && titleBox && titleBox.x >= menuBox.x + menuBox.width, "Wide-display media styles overlap the compact menu");
  await capture("vertical-fold");
  await resize(900, 1000);
  await page.getByRole("textbox").focus();
  await change({ segments: [{ left: 0, top: 0, width: 900, height: 480 }, { left: 0, top: 520, width: 900, height: 480 }] });
  await fit({ left: 0, top: 520, width: 900, height: 480 }); await capture("horizontal-fold");
  await change({ height: 610 });
  await fit({ left: 0, top: 0, width: 900, height: 480 }); results.push("horizontal-fold-keyboard-intersection");
  await resize(1240, 800);
  await change({ segments: [{ left: 0, top: 0, width: 400, height: 800 }, { left: 420, top: 0, width: 400, height: 800 }, { left: 840, top: 0, width: 400, height: 800 }] });
  await fit({ width: 400, height: 800 }); await capture("three-segments");

  await resize(390, 844);
  // Exercise restoration of keyboard focus. Pointer clicks need not focus a
  // button on every engine; preserving the previous textarea focus is valid.
  await page.getByTestId("open-attachment").focus();
  await page.getByTestId("open-attachment").press("Enter");
  const attachment = page.getByTestId("attachment-content-panel");
  await attachment.waitFor(); assert.equal(await attachment.getAttribute("data-layout"), "overlay");
  const panelBounds = await attachment.boundingBox(); assert(panelBounds); assert.equal(panelBounds.width, 390);
  await capture("phone-attachment-overlay");
  for (let count = 0; count < 8; count++) {
    await page.keyboard.press("Tab");
    assert(await attachment.evaluate((panel) => panel.contains(document.activeElement)), "Preview focus escaped");
  }
  await attachment.locator("[data-preview-close]").click();
  await attachment.waitFor({ state: "detached" });
  const restored = await page.getByTestId("open-attachment").evaluate((element) => ({
    matched: document.activeElement === element,
    active: document.activeElement?.outerHTML.slice(0, 240),
  }));
  assert(restored.matched, `Previous keyboard focus was not restored: ${restored.active}`);
  await page.getByTestId("open-research").click();
  const research = page.getByTestId("deep-research-files-panel");
  await research.waitFor(); assert.equal(await research.getAttribute("data-layout"), "overlay");
  assert.equal(await page.getByTestId("deep-research-files-resize-handle").count(), 0);
  await capture("phone-research-overlay");
  await page.keyboard.press("Escape"); await research.waitFor({ state: "detached" });
  await resize(1200, 800);
  await page.getByTestId("open-research").click(); await research.waitFor();
  assert.equal(await research.getAttribute("data-layout"), "docked");
  const handle = page.getByTestId("deep-research-files-resize-handle");
  const handleBox = await handle.boundingBox(); assert(handleBox);
  const before = Number(await research.getAttribute("data-panel-width"));
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 120);
  await page.mouse.down(); await page.mouse.move(handleBox.x - 80, handleBox.y + 120);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel")));
  await page.mouse.up();
  assert(Number(await research.getAttribute("data-panel-width")) > before);
  assert.equal(await page.evaluate(() => document.body.style.cursor), "");
  await capture("wide-research-resized");
  await page.goto(`http://127.0.0.1:${address.port}/?empty=1`, { waitUntil: "networkidle" });
  await resize(390, 844);
  assert(await page.getByTestId("empty-hero").isVisible());
  await page.getByRole("textbox").focus();
  await change({ height: 390, offsetTop: 40 });
  await fit({ left: 0, top: 40, width: 390, height: 390 });
  assert(!(await page.getByTestId("empty-hero").isVisible()), "Empty chat hero crowds the composer");
  await capture("empty-chat-keyboard");
  await resize(844, 390);
  await fit({ left: 0, top: 0, width: 844, height: 390 });
  await capture("empty-chat-short-landscape");
  assert.deepEqual(failures, [], `Uncaught browser errors: ${failures.join("; ")}`);
  assert(results.length >= 13, "Browser scenarios did not all execute");
  await writeFile(path.join(output, "results.json"), JSON.stringify({ engine, simulated: true, scenarios: results, failures }, null, 2));
  await Promise.all(["failure.png", "failure.json"].map((name) => rm(path.join(output, name), { force: true })));
  console.log(`${engine}: ${results.length} simulated geometry/layout scenarios passed; artifacts: ${output}`);
} catch (error) {
  await activePage?.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined);
  await writeFile(path.join(output, "failure.json"), JSON.stringify({ engine, simulated: true, completedScenarios: results, failures, error: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close();
  await server.close();
}
