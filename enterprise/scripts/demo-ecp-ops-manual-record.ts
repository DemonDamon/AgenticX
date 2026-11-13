/**
 * Record Enterprise Capability Platform (ECP) admin+portal product demo as MP4
 * with Chinese VO + burned captions. Investor/human-readable narrative (口语旁白)
 * + focus ring on focal control (no CSS page zoom).
 * Forked from demo-data-suite-ops-manual-record.ts — do NOT break RK/Data Suite recorders.
 *
 * Run (from repo root):
 *   set -a && source enterprise/.env.local && set +a
 *   DEMO_TTS_CACHE_DIR="$(pwd)/.runtime/agx-ecp-demo-tts" \
 *     pnpm -C enterprise exec tsx scripts/demo-ecp-ops-manual-record.ts
 *
 * Do NOT run full MP4 until neural wavs exist under TTS_CACHE_DIR.
 * Cue manifest (for box edge-tts): docs/enterprise-capability-platform/shots/ecp-demo-cues.json
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, execSync } from "node:child_process";

const ADMIN_BASE = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3001";
const PORTAL_BASE = process.env.PORTAL_BASE_URL ?? "http://127.0.0.1:3000";
const ADMIN_EMAIL =
  process.env.ADMIN_CONSOLE_LOGIN_EMAIL?.trim() || "admin@agenticx.local";
const ADMIN_PASSWORD =
  process.env.ADMIN_CONSOLE_LOGIN_PASSWORD?.trim() ||
  process.env.AUTH_DEV_OWNER_PASSWORD?.trim() ||
  "ChangeMe_Dev14!Aa";
const PORTAL_EMAIL = process.env.PORTAL_LOGIN_EMAIL?.trim() || ADMIN_EMAIL;
const PORTAL_PASSWORD =
  process.env.PORTAL_LOGIN_PASSWORD?.trim() || ADMIN_PASSWORD;

const OUT_MP4 = path.resolve(
  __dirname,
  "../..",
  "docs/enterprise-capability-platform/shots/ecp-ops-manual-demo.mp4",
);

const VW = Number(process.env.DEMO_VIEWPORT_W || "1600");
const VH = Number(process.env.DEMO_VIEWPORT_H || "1000");
const DEVICE_SCALE = Number(process.env.DEMO_DEVICE_SCALE || "1");

const TTS_CACHE_DIR =
  process.env.DEMO_TTS_CACHE_DIR?.trim() ||
  path.resolve(__dirname, "../../.runtime/agx-ecp-demo-tts");
const TTS_VOICE =
  process.env.DEMO_TTS_VOICE?.trim() || "zh-CN-XiaoxiaoNeural";
const TTS_RATE = process.env.DEMO_TTS_RATE?.trim() || "+8%";
const SAY_RATE = Number(process.env.DEMO_SAY_RATE || "180");
const CLAUSE_GAP_MS = Number(process.env.DEMO_CLAUSE_GAP_MS || "180");
const ALLOW_SAY = process.env.DEMO_TTS_ALLOW_SAY === "1";

const failures: string[] = [];
const visited: string[] = [];

type Cue = {
  id: string;
  vo: string;
  caption?: string;
  holdAfterMs?: number;
  focus?: string;
  focusScale?: number;
  run: (page: Page) => Promise<void>;
};

type TimelineEntry = {
  id: string;
  vo: string;
  caption: string;
  startSec: number;
  endSec: number;
  wav: string;
};

async function pause(page: Page, ms = 1500): Promise<void> {
  await page.waitForTimeout(ms);
}

async function dismissNextOverlay(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
      const buttons = Array.from(document.querySelectorAll("button"));
      for (const b of buttons) {
        const t = (b.textContent || "").trim();
        if (/Close|Dismiss|×|关闭/.test(t)) b.click();
      }
    })
    .catch(() => undefined);
}

async function safeStep(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    visited.push(`OK ${label}`);
    console.log(`[demo] OK ${label}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${label}: ${msg}`);
    visited.push(`FAIL ${label}`);
    console.error(`[demo] FAIL ${label}: ${msg}`);
  }
}

async function zoomTo(
  page: Page,
  selector: string,
  opts?: { scale?: number; durationMs?: number; padding?: number },
): Promise<void> {
  // No CSS zoom: html transform scale/translate crops the frame and misaligns
  // the blue ring. Keep only a viewport-accurate focus ring around the target.
  // `scale` / focusScale are ignored (kept in signature for cue JSON compat).
  void opts?.scale;
  const durationMs = opts?.durationMs ?? 400;
  const ringPad = opts?.padding ?? 8;
  const loc = page.locator(selector).first();
  const visible = await loc.isVisible().catch(() => false);
  if (!visible) {
    console.warn(`[demo] zoomTo miss: ${selector}`);
    return;
  }
  await loc.scrollIntoViewIfNeeded().catch(() => undefined);
  await page
    .evaluate(
      ({ sel, ringPad }) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const targetY = window.innerHeight * 0.42;
        const delta = r.top + r.height / 2 - targetY;
        if (Math.abs(delta) > 24) {
          window.scrollBy({ top: delta - ringPad * 2, behavior: "auto" });
        }
      },
      { sel: selector, ringPad },
    )
    .catch(() => undefined);
  await page.waitForTimeout(120);
  await page.evaluate(
    ({ sel, durationMs, ringPad }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const inset = 8;
      // Clear any leftover camera transform from older recorder builds.
      const html = document.documentElement as HTMLElement;
      html.style.transition = "";
      html.style.transform = "";
      html.style.transformOrigin = "";
      delete (html as HTMLElement & { dataset: DOMStringMap }).dataset
        .demoZoomScale;

      let left = r.left - ringPad;
      let top = r.top - ringPad;
      let width = r.width + ringPad * 2;
      let height = r.height + ringPad * 2;
      // Clamp ring to viewport so huge targets (sidebar / dialog) never escape.
      left = Math.max(inset, Math.min(left, vw - inset - 16));
      top = Math.max(inset, Math.min(top, vh - inset - 16));
      width = Math.min(width, vw - inset - left);
      height = Math.min(height, vh - inset - top);
      width = Math.max(16, width);
      height = Math.max(16, height);

      let ring = document.getElementById("demo-zoom-ring");
      if (!ring) {
        ring = document.createElement("div");
        ring.id = "demo-zoom-ring";
        document.body.appendChild(ring);
      }
      Object.assign(ring.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: "2px solid rgba(96,165,250,0.95)",
        borderRadius: "10px",
        boxShadow:
          "0 0 0 9999px rgba(15,23,42,0.28), 0 0 24px rgba(59,130,246,0.45)",
        pointerEvents: "none",
        zIndex: "2147483646",
        transition: `opacity ${Math.min(280, durationMs)}ms ease`,
        transform: "none",
        transformOrigin: "unset",
        opacity: "1",
      } as CSSStyleDeclaration);
    },
    { sel: selector, durationMs, ringPad },
  );
  await page.waitForTimeout(Math.min(durationMs, 280) + 40);
}

async function zoomOut(
  page: Page,
  opts?: { durationMs?: number },
): Promise<void> {
  const durationMs = opts?.durationMs ?? 280;
  await page
    .evaluate((durationMs) => {
      const html = document.documentElement as HTMLElement;
      html.style.transition = "";
      html.style.transform = "";
      html.style.transformOrigin = "";
      delete (html as HTMLElement & { dataset: DOMStringMap }).dataset
        .demoZoomScale;
      const ring = document.getElementById("demo-zoom-ring");
      if (ring) {
        ring.style.opacity = "0";
        setTimeout(() => ring.remove(), durationMs + 40);
      }
    }, durationMs)
    .catch(() => undefined);
  await page.waitForTimeout(durationMs + 60);
}

async function adminLogin(page: Page): Promise<void> {
  const api = await page.request.post(`${ADMIN_BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (api.ok()) {
    await page.goto(`${ADMIN_BASE}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!page.url().includes("/login")) {
      await dismissNextOverlay(page);
      return;
    }
  }
  await page.goto(`${ADMIN_BASE}/login`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await dismissNextOverlay(page);
  const email = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();
  await email.waitFor({ state: "visible", timeout: 20_000 });
  await email.click({ force: true });
  await email.fill("");
  await email.fill(ADMIN_EMAIL);
  await password.click({ force: true });
  await password.fill("");
  await password.fill(ADMIN_PASSWORD);
  await page.waitForTimeout(300);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 45_000 }),
    page
      .getByRole("button", { name: /登录并进入控制台|Sign in to console/i })
      .click({ force: true }),
  ]);
  await dismissNextOverlay(page);
}


async function portalLogin(page: Page): Promise<void> {
  const api = await page.request.post(`${PORTAL_BASE}/api/auth/login`, {
    data: { email: PORTAL_EMAIL, password: PORTAL_PASSWORD },
  });
  if (api.ok()) {
    await page.goto(`${PORTAL_BASE}/workspace`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!page.url().includes("/auth")) {
      await dismissNextOverlay(page);
      return;
    }
  }
  await page.goto(`${PORTAL_BASE}/auth`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await dismissNextOverlay(page);
  const email = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();
  await email.waitFor({ state: "visible", timeout: 20_000 });
  await email.fill(PORTAL_EMAIL);
  await password.fill(PORTAL_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/workspace/, { timeout: 45_000 }),
    page.locator('button[type="submit"]').first().click({ force: true }),
  ]);
  await dismissNextOverlay(page);
}

function splitClauses(text: string): string[] {
  const parts = text
    .split(/(?<=[。！？…；])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

function wavDuration(wav: string): number {
  return Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nokey=1:noprint_wrappers=1",
        wav,
      ],
      { encoding: "utf8" },
    ).trim(),
  );
}

function sayClauseToWav(text: string, outWav: string, workDir: string): void {
  if (!ALLOW_SAY) {
    throw new Error(
      `macOS say blocked (set DEMO_TTS_ALLOW_SAY=1 only as last resort). Missing neural wav for: ${text.slice(0, 40)}`,
    );
  }
  const aiff = path.join(workDir, `${path.basename(outWav, ".wav")}.aiff`);
  const sayVoice =
    process.env.DEMO_SAY_VOICE?.trim() || "Shelley (中文（中国大陆）)";
  execFileSync(
    "say",
    ["-v", sayVoice, "-r", String(SAY_RATE), "-o", aiff, text],
    { stdio: "pipe" },
  );
  execFileSync(
    "ffmpeg",
    ["-y", "-i", aiff, "-ar", "44100", "-ac", "1", outWav],
    { stdio: "pipe" },
  );
  try {
    fs.unlinkSync(aiff);
  } catch {
    /* ignore */
  }
}

function sayToWav(
  text: string,
  outWav: string,
  workDir: string,
  cueId?: string,
): number {
  if (cueId) {
    const cached = path.join(TTS_CACHE_DIR, `${cueId}.wav`);
    if (fs.existsSync(cached)) {
      fs.copyFileSync(cached, outWav);
      return wavDuration(outWav);
    }
    if (!ALLOW_SAY) {
      throw new Error(
        `missing neural TTS cache: ${cached} (generate with edge-tts / set DEMO_TTS_CACHE_DIR)`,
      );
    }
    console.warn(`[demo] cache miss ${cueId}, falling back to macOS say`);
  }

  const clauses = splitClauses(text);
  if (clauses.length === 1) {
    sayClauseToWav(clauses[0], outWav, workDir);
    return wavDuration(outWav);
  }
  const chunkDir = path.join(workDir, `${path.basename(outWav, ".wav")}-chunks`);
  fs.mkdirSync(chunkDir, { recursive: true });
  const sil = path.join(chunkDir, "sil.wav");
  const gapSec = (CLAUSE_GAP_MS / 1000).toFixed(3);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      gapSec,
      sil,
    ],
    { stdio: "pipe" },
  );
  const listPath = path.join(chunkDir, "list.txt");
  const lines: string[] = [];
  clauses.forEach((clause, i) => {
    const wav = path.join(chunkDir, `c${i}.wav`);
    sayClauseToWav(clause, wav, chunkDir);
    lines.push(`file '${wav}'`);
    if (i < clauses.length - 1) lines.push(`file '${sil}'`);
  });
  fs.writeFileSync(listPath, lines.join("\n") + "\n", "utf8");
  execFileSync(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outWav],
    { stdio: "pipe" },
  );
  return wavDuration(outWav);
}

function formatSrtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function wrapCaption(text: string, maxChars = 22): string {
  const chars = [...text];
  if (chars.length <= maxChars) return text;
  const lines: string[] = [];
  let buf = "";
  for (const ch of chars) {
    buf += ch;
    if (buf.length >= maxChars && /[，。；！？、：,]/.test(ch)) {
      lines.push(buf);
      buf = "";
    } else if (buf.length >= maxChars + 6) {
      lines.push(buf);
      buf = "";
    }
  }
  if (buf) lines.push(buf);
  return lines.slice(0, 3).join("\n");
}

function buildCues(): Cue[] {
  return [
    {
      id: "open-title",
      vo: "大家好。今天用脱敏样例，给各位看 AgenticX 的企业能力平台。不讲底层实现，就讲平台怎么把技能和专家包，安全地分到各个租户，桌面上还能认出企业官方。",
      caption: "企业能力平台 · 目录到桌面闭环",
      holdAfterMs: 250,
      run: async (page) => {
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif}
            .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:48px;text-align:center}
            h1{font-size:48px;margin:0 0 18px;letter-spacing:1px}
            p{font-size:24px;line-height:1.7;max-width:980px;opacity:.92;margin:0}
            .tag{margin-top:28px;font-size:17px;color:#93c5fd;border:1px solid #334155;border-radius:999px;padding:8px 18px}
          </style></head><body><div class="wrap">
            <h1>AgenticX 企业能力平台</h1>
            <p>平台目录 → 扫描发布 → 跨租户授权 → 门户分配 → 桌面「企业官方」。</p>
            <div class="tag">产品演示 · 脱敏样例 · 投资人 / 业务可读</div>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 700);
      },
    },
    {
      id: "open-why",
      vo: "一句话业务：平台统一维护货架，租户按授权取用。路径很清楚——建目录、扫安全、发布上架、授权给租户，门户和桌面再分配。撤销默认停更新、留副本，不搞偷偷恢复。",
      caption: "建目录 → 扫描 → 发布 → 授权 → 桌面企业官方",
      holdAfterMs: 220,
      run: async (page) => {
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif}
            .wrap{max-width:960px;margin:0 auto;padding:72px 48px}
            h2{font-size:30px;margin:0 0 28px;color:#93c5fd}
            ol{font-size:23px;line-height:2;margin:0;padding-left:1.4em}
            li{margin-bottom:8px}
          </style></head><body><div class="wrap">
            <h2>今天演示路径</h2>
            <ol>
              <li>登录管理台</li>
              <li>平台目录：新建草稿</li>
              <li>版本扫描 → 发布</li>
              <li>授权租户（grant / revoke）</li>
              <li>租户库「平台下发」+ 门户可见</li>
              <li>Desktop Skills「企业官方」</li>
              <li>可选：上架审核</li>
            </ol>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 600);
      },
    },
    {
      id: "admin-login",
      vo: "先登录管理台。管理员进来以后，能力包入口都在左侧，中文界面一眼能找着。",
      caption: "管理台登录 → Dashboard",
      holdAfterMs: 250,
      focus: "main, [data-testid='admin-dashboard'], body",
      focusScale: 1.35,
      run: async (page) => {
        await adminLogin(page);
        await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
        await pause(page, 1000);
      },
    },
    {
      id: "ecp-tab",
      vo: "打开能力包，切到平台目录页签。这里是平台侧的货架：技能包、专家包都在这儿登记，不是某个客户的专属后台。",
      caption: "能力包 → 平台目录",
      holdAfterMs: 350,
      focus: 'main',
      focusScale: 1.6,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/capabilities?tab=ecp`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.waitForTimeout(1200);
        const title = page.getByText("平台能力目录");
        await title.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
        await pause(page, 800);
      },
    },
    {
      id: "create",
      vo: "先新建一条目录草稿。填标识、显示名，选技能包或专家包。创建成功后是草稿状态，还不能直接分给租户。",
      caption: "新建目录草稿（draft）",
      holdAfterMs: 380,
      focus: "#catalog-slug, main",
      focusScale: 1.75,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        const slug = page.locator("#catalog-slug");
        if (await slug.isVisible().catch(() => false)) {
          await slug.scrollIntoViewIfNeeded();
          // Demo fill only if empty — avoid mutating prod data repeatedly when already has demos
          const v = await slug.inputValue().catch(() => "");
          if (!v) {
            await slug.fill(`demo-ecp-${Date.now().toString(36).slice(-6)}`);
            const name = page.locator("#catalog-name");
            if (await name.isVisible().catch(() => false)) {
              await name.fill("冷却巡检技能（演示）");
            }
          }
        }
        await pause(page, 900);
      },
    },
    {
      id: "scan",
      vo: "展开这条，给版本点扫描。安全结论会记下来。高危不能靠人手改成安全，扫描是自动门禁。",
      caption: "版本安全扫描",
      holdAfterMs: 380,
      focus: 'main',
      focusScale: 1.8,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        // Expand first catalog row if present
        // Prefer clicking a list row that looks like a catalog item (contains draft/published badge text)
        const item = page
          .locator("button")
          .filter({ hasText: /草稿|已发布|已下架|draft|published/i })
          .first();
        if (await item.isVisible().catch(() => false)) {
          await item.click({ force: true });
          await page.waitForTimeout(800);
        }
        const versions = page.getByText("版本与上架");
        await versions.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
        await pause(page, 800);
      },
    },
    {
      id: "publish",
      vo: "扫描过了再点发布。如果开了上架审核，没审完会拦住；没开审核就直接变成已发布。",
      caption: "发布上架（published）",
      holdAfterMs: 380,
      focus: 'main',
      focusScale: 1.8,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        const publishBtn = page.getByRole("button", { name: /^发布$/ }).first();
        await publishBtn.scrollIntoViewIfNeeded().catch(() => undefined);
        await pause(page, 900);
      },
    },
    {
      id: "grant",
      vo: "接下来授权给指定租户。填租户 ID，点授权。撤销的时候，默认停掉后续更新，桌面上已经同步的副本先留着。",
      caption: "租户授权 grant / revoke",
      holdAfterMs: 400,
      focus: 'main',
      focusScale: 1.75,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        const grants = page.getByText("租户授权");
        if (await grants.isVisible().catch(() => false)) {
          await grants.scrollIntoViewIfNeeded();
        } else {
          // ensure expanded
          const item = page
            .locator("button")
            .filter({ hasText: /草稿|已发布|已下架/i })
            .first();
          if (await item.isVisible().catch(() => false)) {
            await item.click({ force: true });
            await page.waitForTimeout(700);
          }
        }
        await pause(page, 900);
      },
    },
    {
      id: "tenant-library",
      vo: "切回能力包列表，能看到平台下发标识。租户改不了平台元数据，但可以二次分配给员工和能力包成员。",
      caption: "租户库：平台下发只读 + 二次分配",
      holdAfterMs: 350,
      focus: 'main',
      focusScale: 1.65,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/capabilities`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.waitForTimeout(1200);
        await page.getByText("平台下发").first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
        await pause(page, 800);
      },
    },
    {
      id: "portal-bootstrap",
      vo: "再看门户。员工登录工作区以后，按企业分配策略拿到可用能力。平台物是 bootstrap 下来的，不是每人自己乱装。",
      caption: "门户：按分配可见平台能力",
      holdAfterMs: 350,
      focus: "main, body",
      focusScale: 1.35,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await portalLogin(page);
        await page.waitForTimeout(1000);
        await pause(page, 900);
      },
    },
    {
      id: "desktop-badge",
      vo: "桌面端打开技能配置，平台同步过来的技能会打上企业官方徽章。一线同事一眼就知道：这是企业下发的，不是随便装的第三方。",
      caption: "Desktop Skills：企业官方徽章",
      holdAfterMs: 350,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        // Desktop CDP optional — show story card; still shot lives in ops manual
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif}
            .wrap{max-width:980px;margin:0 auto;padding:72px 48px}
            h2{font-size:34px;margin:0 0 18px;color:#86efac}
            p{font-size:22px;line-height:1.8;opacity:.92}
            .badge{display:inline-block;margin-top:18px;padding:8px 16px;border-radius:999px;background:#14532d;border:1px solid #22c55e;color:#bbf7d0;font-size:18px}
            .note{margin-top:28px;font-size:16px;color:#94a3b8}
          </style></head><body><div class="wrap">
            <h2>Desktop · 技能配置</h2>
            <p>平台下发并同步到本机的技能，在 Skills 列表显示「企业官方」徽章；市场筛选也可只看企业官方。</p>
            <div class="badge">企业官方</div>
            <p class="note">书面手册配图：docs/enterprise-capability-platform/shots/06-desktop-enterprise-badge.png</p>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 700);
      },
    },
    {
      id: "approvals",
      vo: "上架审核页可以按需打开。给 Skill 上架、引入平台物、目录发布配审核链路；关掉就只靠扫描门禁。通过或驳回都会留痕。",
      caption: "可选：上架审核队列",
      holdAfterMs: 320,
      focus: 'main',
      focusScale: 1.55,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/capabilities?tab=approvals`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.waitForTimeout(1200);
        await pause(page, 800);
      },
    },
    {
      id: "closing",
      vo: "演示到这儿。平台目录、扫描发布、跨租户授权，再到门户分配和桌面企业官方。谢谢各位。",
      caption: "谢谢 · 企业能力平台产品演示",
      holdAfterMs: 400,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif}
            .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:48px;text-align:center;gap:18px}
            h1{font-size:38px;margin:0}
            p{font-size:23px;line-height:1.8;max-width:920px;margin:0;opacity:.92}
            .pill{margin-top:12px;font-size:18px;color:#86efac;border:1px solid #166534;border-radius:999px;padding:8px 18px}
          </style></head><body><div class="wrap">
            <h1>谢谢观看</h1>
            <p>平台目录 · 扫描 · 发布 · 跨租户授权<br/>门户分配 · Desktop「企业官方」</p>
            <div class="pill">脱敏样例 · AgenticX 企业能力平台</div>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 600);
      },
    },
  ];
}

async function resolveFocusSelector(
  page: Page,
  focus: string,
): Promise<string | null> {
  const parts = focus.split(",").map((s) => s.trim()).filter(Boolean);
  for (const sel of parts) {
    const ok = await page.locator(sel).first().isVisible().catch(() => false);
    if (ok) return sel;
  }
  return null;
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_MP4), { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecp-ops-demo-"));
  const videoDir = path.join(workDir, "video");
  const audioDir = path.join(workDir, "audio");
  fs.mkdirSync(videoDir);
  fs.mkdirSync(audioDir);

  console.log(`[demo] workDir=${workDir}`);
  console.log(`[demo] out=${OUT_MP4}`);
  console.log(
    `[demo] TTS neural cache: dir=${TTS_CACHE_DIR} voice=${TTS_VOICE} rate=${TTS_RATE} clauseGapMs=${CLAUSE_GAP_MS} allowSay=${ALLOW_SAY}`,
  );
  console.log(
    `[demo] viewport=${VW}x${VH} deviceScaleFactor=${DEVICE_SCALE} camera=focus-ring-only (no css zoom)`,
  );

  const cues = buildCues();

  const voMeta: Array<{
    id: string;
    wav: string;
    dur: number;
    caption: string;
    vo: string;
  }> = [];
  for (const cue of cues) {
    const wav = path.join(audioDir, `${cue.id}.wav`);
    const dur = sayToWav(cue.vo, wav, audioDir, cue.id);
    voMeta.push({
      id: cue.id,
      wav,
      dur,
      caption: cue.caption || cue.vo,
      vo: cue.vo,
    });
    console.log(`[demo] TTS ${cue.id}: ${dur.toFixed(2)}s`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: DEVICE_SCALE,
    recordVideo: { dir: videoDir, size: { width: VW, height: VH } },
  });
  const page = await context.newPage();

  const timeline: TimelineEntry[] = [];
  const t0 = Date.now();

  try {
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const meta = voMeta[i];
      await safeStep(cue.id, async () => {
        const actionStart = (Date.now() - t0) / 1000;
        await cue.run(page);
        if (cue.focus) {
          const sel = await resolveFocusSelector(page, cue.focus);
          if (sel) {
            await zoomTo(page, sel, {
              durationMs: 320,
            });
          }
        }
        const voStart = (Date.now() - t0) / 1000;
        const holdMs = Math.ceil(meta.dur * 1000) + (cue.holdAfterMs ?? 250);
        await pause(page, holdMs);
        const voEnd = voStart + meta.dur;
        timeline.push({
          id: cue.id,
          vo: meta.vo,
          caption: meta.caption,
          startSec: voStart,
          endSec: voEnd,
          wav: meta.wav,
        });
        if (cue.focus) {
          await zoomOut(page, { durationMs: 280 });
        }
        console.log(
          `[demo] cue ${cue.id}: action@${actionStart.toFixed(1)}s vo@${voStart.toFixed(1)}-${voEnd.toFixed(1)}s focus=${cue.focus ?? "-"}`,
        );
      });
    }
    await pause(page, 1500);
  } finally {
    await context.close();
    await browser.close();
  }

  const webms = fs
    .readdirSync(videoDir)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => path.join(videoDir, f));
  if (webms.length < 1) {
    throw new Error(`no webm produced in ${videoDir}`);
  }
  const webm = webms[0];
  console.log(`[demo] webm=${webm} size=${fs.statSync(webm).size}`);

  const videoDur = Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nokey=1:noprint_wrappers=1",
        webm,
      ],
      { encoding: "utf8" },
    ).trim(),
  );
  console.log(`[demo] videoDur=${videoDur.toFixed(2)}s`);

  const inputs: string[] = [];
  const filterParts: string[] = [];
  timeline.forEach((t, idx) => {
    inputs.push("-i", t.wav);
    const delayMs = Math.max(0, Math.round(t.startSec * 1000));
    filterParts.push(
      `[${idx}]adelay=${delayMs}|${delayMs},apad=whole_dur=${Math.max(videoDur, t.endSec + 1).toFixed(3)}[a${idx}]`,
    );
  });
  const mixInputs = timeline.map((_, i) => `[a${i}]`).join("");
  const filterComplex =
    filterParts.join(";") +
    `;${mixInputs}amix=inputs=${timeline.length}:duration=longest:dropout_transition=0:normalize=0[aout]`;

  const mixedWav = path.join(workDir, "vo-mixed.wav");
  console.log(`[demo] mixing ${timeline.length} VO clips…`);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      ...inputs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[aout]",
      "-ar",
      "44100",
      "-ac",
      "1",
      mixedWav,
    ],
    { stdio: "pipe" },
  );

  const srtPath = path.join(workDir, "captions.srt");
  const srtBody = timeline
    .map((t, i) => {
      const end = Math.min(t.endSec + 0.35, videoDur);
      return `${i + 1}\n${formatSrtTime(t.startSec)} --> ${formatSrtTime(end)}\n${wrapCaption(t.caption)}\n`;
    })
    .join("\n");
  fs.writeFileSync(srtPath, srtBody, "utf8");

  const srtEscaped = srtPath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");

  const tmpMp4 = path.join(workDir, "out-nosub.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      webm,
      "-i",
      mixedWav,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      tmpMp4,
    ],
    { stdio: "inherit" },
  );

  const forceStyle =
    "FontName=Arial Unicode MS,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BackColour=&H80000000,BorderStyle=4,Outline=1,Shadow=0,MarginV=48,Alignment=2";
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        tmpMp4,
        "-vf",
        `subtitles=${srtEscaped}:fontsdir=/Library/Fonts:force_style='${forceStyle}'`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        OUT_MP4,
      ],
      { stdio: "inherit" },
    );
  } catch (err) {
    console.warn("[demo] subtitles filter failed, copying mux only", err);
    fs.copyFileSync(tmpMp4, OUT_MP4);
  }

  let hasAudio = false;
  try {
    const streams = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_streams",
        "-select_streams",
        "a",
        "-of",
        "csv=p=0",
        OUT_MP4,
      ],
      { encoding: "utf8" },
    ).trim();
    hasAudio = streams.length > 0;
  } catch {
    hasAudio = false;
  }

  const st = fs.statSync(OUT_MP4);
  let duration = "?";
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        OUT_MP4,
      ],
      { encoding: "utf8" },
    ).trim();
    duration = `${Number(out).toFixed(1)}s`;
  } catch {
    /* ignore */
  }

  const outSrt = OUT_MP4.replace(/\.mp4$/, ".zh.srt");
  fs.copyFileSync(srtPath, outSrt);

  console.log("==== DEMO SUMMARY ====");
  console.log(`mp4=${OUT_MP4}`);
  console.log(`srt=${outSrt}`);
  console.log(`size_bytes=${st.size}`);
  console.log(`duration=${duration}`);
  console.log(`has_audio=${hasAudio}`);
  console.log(`tts_voice=${TTS_VOICE}`);
  console.log(`tts_rate=${TTS_RATE}`);
  console.log(`viewport=${VW}x${VH}`);
  console.log(`camera=focus-ring-only (no css zoom)`);
  console.log(`cues=${timeline.length}`);
  console.log("visited:");
  for (const v of visited) console.log(`  ${v}`);
  if (failures.length) {
    console.log("failures:");
    for (const f of failures) console.log(`  ${f}`);
  } else {
    console.log("failures: none");
  }

  try {
    execSync(`rm -rf "${workDir}"`, { stdio: "ignore" });
  } catch {
    /* ignore */
  }

  if (!hasAudio) process.exitCode = 2;
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[demo] FATAL", err);
  process.exit(1);
});
