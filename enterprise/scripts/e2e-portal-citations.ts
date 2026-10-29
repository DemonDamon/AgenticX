import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PORTAL_BASE = "http://127.0.0.1:3000";
const email =
  process.env.ADMIN_CONSOLE_LOGIN_EMAIL?.trim() || "admin@agenticx.local";
const password =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";
const shotDir = path.resolve(
  "/Users/damon/myWork/AgenticX/docs/agx-rules-knowledge-suite/e2e-shots",
);
fs.mkdirSync(shotDir, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  try {
    await page.goto(`${PORTAL_BASE}/auth`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.locator("input[type=email]").first().fill(email);
    await page.locator("input[type=password]").first().fill(password);
    await Promise.all([
      page.waitForURL(/\/workspace/, { timeout: 45_000 }),
      page.locator("button[type=submit]").first().click({ force: true }),
    ]);
    await page.goto(`${PORTAL_BASE}/workspace/citations`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByTestId("portal-citations-page").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("citation-evidence-panel").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("citation-evidence-conflicts").waitFor({ state: "visible", timeout: 10_000 });
    const name = "16-portal-citation-evidence.png";
    const out = path.join(shotDir, name);
    await page.screenshot({ path: out, fullPage: true });
    const md5 = crypto.createHash("md5").update(fs.readFileSync(out)).digest("hex");
    console.log("shot", name, "md5", md5);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
