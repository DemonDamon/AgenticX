/**
 * Record Enterprise admin+portal product demo as MP4 with Chinese VO + burned captions.
 * Investor/human-readable narrative (口语旁白) + documentary camera (zoom local → global).
 * Keep local/untracked.
 *
 * Run (from repo root):
 *   set -a && source enterprise/.env.local && set +a
 *   pnpm -C enterprise exec tsx scripts/demo-rk-ops-manual-record.ts
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
  "docs/agx-rules-knowledge-suite/e2e-shots/rk-ops-manual-demo.mp4",
);

/** Larger viewport so UI fills the frame (not a shrunk half-page). */
const VW = Number(process.env.DEMO_VIEWPORT_W || "1600");
const VH = Number(process.env.DEMO_VIEWPORT_H || "1000");
const DEVICE_SCALE = Number(process.env.DEMO_DEVICE_SCALE || "1");

/**
 * Neural Mandarin VO via Microsoft edge-tts (generated on Grok Bot box, cached on Mac).
 * Default cache: /tmp/agx-rk-demo-tts/<cueId>.wav — voice zh-CN-XiaoxiaoNeural @ +8%.
 * Do NOT fall back to macOS `say` unless DEMO_TTS_ALLOW_SAY=1.
 * Override: DEMO_TTS_CACHE_DIR / DEMO_TTS_VOICE / DEMO_TTS_RATE / DEMO_CLAUSE_GAP_MS.
 */
const TTS_CACHE_DIR =
  process.env.DEMO_TTS_CACHE_DIR?.trim() || path.resolve(__dirname, "../../.runtime/agx-rk-demo-tts");
const TTS_VOICE =
  process.env.DEMO_TTS_VOICE?.trim() || "zh-CN-XiaoxiaoNeural";
const TTS_RATE = process.env.DEMO_TTS_RATE?.trim() || "+8%";
/** Legacy macOS say rate (only if DEMO_TTS_ALLOW_SAY=1). */
const SAY_RATE = Number(process.env.DEMO_SAY_RATE || "180");
/** Silence between spoken clauses (ms); neural clips are whole-cue so this is rarely used. */
const CLAUSE_GAP_MS = Number(process.env.DEMO_CLAUSE_GAP_MS || "180");
const ALLOW_SAY = process.env.DEMO_TTS_ALLOW_SAY === "1";
const FONT_FILE =
  process.env.DEMO_CAPTION_FONT || "/Library/Fonts/Arial Unicode.ttf";

const failures: string[] = [];
const visited: string[] = [];

type Cue = {
  id: string;
  /** Spoken Chinese narration (also used as caption unless caption set). */
  vo: string;
  /** Optional shorter on-screen caption. */
  caption?: string;
  /** Extra hold after VO finishes (ms). */
  holdAfterMs?: number;
  /**
   * After run(), zoom into this selector while VO plays (documentary beat).
   * Title/agenda cards leave this empty (full-frame).
   */
  focus?: string;
  /** Zoom scale for focus (default 1.85). */
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

/* -------------------------------------------------------------------------- */
/* Documentary camera: CSS transform zoom on html (clicks stay aligned if we  */
/* zoomOut before the next interaction).                                       */
/* -------------------------------------------------------------------------- */

async function zoomTo(
  page: Page,
  selector: string,
  opts?: { scale?: number; durationMs?: number; padding?: number },
): Promise<void> {
  const scale = opts?.scale ?? 1.85;
  const durationMs = opts?.durationMs ?? 850;
  const padding = opts?.padding ?? 56;
  const loc = page.locator(selector).first();
  const visible = await loc.isVisible().catch(() => false);
  if (!visible) {
    console.warn(`[demo] zoomTo miss: ${selector}`);
    return;
  }
  await loc.scrollIntoViewIfNeeded().catch(() => undefined);
  // Nudge into upper-middle of viewport before zoom
  await page
    .evaluate(
      ({ sel, padding }) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const targetY = window.innerHeight * 0.32;
        const delta = r.top - targetY;
        if (Math.abs(delta) > 24) {
          window.scrollBy({ top: delta - padding * 0.2, behavior: "auto" });
        }
      },
      { sel: selector, padding },
    )
    .catch(() => undefined);
  await page.waitForTimeout(180);
  await page.evaluate(
    ({ sel, scale, durationMs }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ox = r.left + r.width / 2;
      const oy = r.top + Math.min(r.height * 0.35, 80);
      const html = document.documentElement as HTMLElement;
      html.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      html.style.transformOrigin = `${ox}px ${oy}px`;
      html.style.transform = `scale(${scale})`;
      // Soft highlight ring so the local subject reads clearly
      let ring = document.getElementById("demo-zoom-ring");
      if (!ring) {
        ring = document.createElement("div");
        ring.id = "demo-zoom-ring";
        document.body.appendChild(ring);
      }
      const rr = el.getBoundingClientRect();
      Object.assign(ring.style, {
        position: "fixed",
        left: `${rr.left - 8}px`,
        top: `${rr.top - 8}px`,
        width: `${rr.width + 16}px`,
        height: `${rr.height + 16}px`,
        border: "2px solid rgba(96,165,250,0.95)",
        borderRadius: "10px",
        boxShadow: "0 0 0 9999px rgba(15,23,42,0.28), 0 0 24px rgba(59,130,246,0.45)",
        pointerEvents: "none",
        zIndex: "2147483646",
        transition: `opacity ${Math.min(400, durationMs)}ms ease`,
        opacity: "1",
      } as CSSStyleDeclaration);
    },
    { sel: selector, scale, durationMs },
  );
  await page.waitForTimeout(durationMs + 60);
}

async function zoomOut(
  page: Page,
  opts?: { durationMs?: number },
): Promise<void> {
  const durationMs = opts?.durationMs ?? 700;
  await page
    .evaluate((durationMs) => {
      const html = document.documentElement as HTMLElement;
      html.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      html.style.transform = "scale(1)";
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
  // Prefer API cookie login — more reliable after next-dev restarts
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

/** Split VO into short spoken clauses so TTS breathes. */
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

/**
 * Prefer pre-generated neural wav from DEMO_TTS_CACHE_DIR/<cueId>.wav
 * (edge-tts on box → CopyFromBox). Falls back to macOS say only if ALLOW_SAY.
 */
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
      vo: "大家好。今天用「示例化工厂 · 冷却回路」这个脱敏样例，给各位看 AgenticX 的规则与知识套件。不讲底层实现，就讲产品怎么帮运维把规则和知识管明白。",
      caption: "示例化工厂 · 冷却回路 · 规则与知识演示",
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
            <h1>AgenticX 规则与知识套件</h1>
            <p>让企业里的规则、知识和图谱可治理、可追溯；遇歧义可人工确认。</p>
            <div class="tag">产品演示 · 脱敏示例数据 · 投资人 / 业务可读</div>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 700);
      },
    },
    {
      id: "open-why",
      vo: "一句话业务：值班同事说「冷却超温要告警」，AI 起草规则时不确定该绑哪台设备，需要人点一下确认；知识条目要可质检；设备关系要进图谱可看。样例已脱敏，不是真实客户。",
      caption: "冷却超温告警 → 人工消歧绑设备 · 知识可质检 · 图谱可看",
      holdAfterMs: 200,
      run: async (page) => {
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif}
            .wrap{max-width:960px;margin:0 auto;padding:72px 48px}
            h2{font-size:30px;margin:0 0 28px;color:#93c5fd}
            ol{font-size:23px;line-height:2;margin:0;padding-left:1.4em}
            li{margin-bottom:8px}
          </style></head><body><div class="wrap">
            <h2>演示路径</h2>
            <ol>
              <li>规则治理：有哪些业务规则在管、有没有跑过</li>
              <li>知识生命周期：状态与质量问题</li>
              <li>消歧确认：候选选择 / 信息补充 / 冲突裁决</li>
              <li>图谱：增量同步 + 探索画布</li>
              <li>门户：一线同事也能确认歧义、核对出处</li>
            </ol>
          </div></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        await pause(page, 600);
      },
    },
    {
      id: "admin-login",
      vo: "咱们先登录管理台。管理员进来以后，规则、知识、图谱，都能在一个地方看。",
      caption: "管理台登录：规则 / 知识 / 图谱统一入口",
      holdAfterMs: 220,
      focus: "main, [data-testid='admin-dashboard'], body",
      focusScale: 1.35,
      run: async (page) => {
        await adminLogin(page);
        await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
        await pause(page, 1000);
      },
    },
    {
      id: "rules-list",
      vo: "先看规则治理。列表里是「冷却回路超温告警」这类业务规则。先把家底摸清，再谈 AI 起草和绑定。",
      caption: "规则治理：冷却回路超温告警",
      holdAfterMs: 350,
      focus: '[data-testid="rule-governance-list"]',
      focusScale: 1.75,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/rule-governance`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page
          .getByTestId("rule-governance-page")
          .waitFor({ state: "visible", timeout: 30_000 });
        const loading = page.getByText(/加载规则中|Loading rules/i);
        try {
          await loading.waitFor({ state: "hidden", timeout: 20_000 });
        } catch {
          /* ok */
        }
        await page
          .getByTestId("rule-governance-list")
          .waitFor({ state: "visible", timeout: 20_000 });
        await pause(page, 700);
      },
    },
    {
      id: "rules-detail",
      vo: "点开一条看看详情。往下再看最近执行。目的很简单：规则不是写在纸上就完了，系统里有没有真正跑过，得看得见。",
      caption: "规则详情 + 最近执行：有没有真正跑过",
      holdAfterMs: 400,
      focus: '[data-testid="rule-governance-detail"]',
      focusScale: 1.9,
      run: async (page) => {
        await zoomOut(page, { durationMs: 450 }).catch(() => undefined);
        const prefer = page.getByTestId(
          "rule-governance-row-rule-cooling-overtemp",
        );
        if (await prefer.isVisible().catch(() => false)) {
          await prefer.click();
        } else {
          await page
            .locator('[data-testid="rule-governance-table"] tbody tr')
            .first()
            .click();
        }
        await page
          .getByTestId("rule-governance-detail")
          .waitFor({ state: "visible", timeout: 15_000 });
        await pause(page, 800);
        const executions = page.getByTestId("rule-governance-executions");
        if (await executions.isVisible().catch(() => false)) {
          await executions.scrollIntoViewIfNeeded();
          await pause(page, 500);
        }
      },
    },
    {
      id: "knowledge-list",
      vo: "接下来是知识生命周期。知识不是扔进库就完了。状态要管，质检也要管。",
      caption: "知识生命周期：管状态，也管质检",
      holdAfterMs: 280,
      focus: '[data-testid="knowledge-lifecycle-list"]',
      focusScale: 1.75,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/knowledge-lifecycle`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page
          .getByTestId("knowledge-lifecycle-page")
          .waitFor({ state: "visible", timeout: 30_000 });
        const loading = page.getByText(/加载知识对象|Loading knowledge/i);
        try {
          await loading.waitFor({ state: "hidden", timeout: 20_000 });
        } catch {
          /* ok */
        }
        await page
          .getByTestId("knowledge-lifecycle-list")
          .waitFor({ state: "visible", timeout: 20_000 });
        await pause(page, 700);
      },
    },
    {
      id: "knowledge-detail",
      vo: "咱们点开示例对象，比如 2号循环泵。你看这块：当前状态在这儿，点一下质量检查，有问题会列出来，方便人审核。",
      caption: "示例：2号循环泵 — 看状态、跑质检",
      holdAfterMs: 400,
      focus: '[data-testid="knowledge-lifecycle-detail"]',
      focusScale: 1.9,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        const prefer = page.getByTestId(
          "knowledge-lifecycle-row-device-pump-02",
        );
        if (await prefer.isVisible().catch(() => false)) {
          await prefer.click();
        } else {
          await page
            .locator('[data-testid="knowledge-lifecycle-table"] tbody tr')
            .first()
            .click();
        }
        await page
          .getByTestId("knowledge-lifecycle-detail")
          .waitFor({ state: "visible", timeout: 15_000 });
        await pause(page, 600);
        const qualityBtn = page.getByTestId("knowledge-lifecycle-run-quality");
        if (await qualityBtn.isVisible().catch(() => false)) {
          await qualityBtn.click();
          await pause(page, 1400);
        }
        const issues = page.getByTestId("knowledge-lifecycle-issues");
        if (await issues.isVisible().catch(() => false)) {
          await issues.scrollIntoViewIfNeeded();
          await pause(page, 500);
        }
      },
    },
    {
      id: "das-intro",
      vo: "冷却回路里泵和阀容易同名混淆。消歧确认，就是把拍板权留给人。下面三种模式：候选选择、信息补充、冲突裁决。",
      caption: "消歧：同名冲突时由人拍板（三种模式）",
      holdAfterMs: 280,
      focus: '[data-testid="disambiguation-table"]',
      focusScale: 1.7,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/disambiguation`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await dismissNextOverlay(page);
        await page
          .getByTestId("disambiguation-page")
          .waitFor({ state: "visible", timeout: 30_000 });
        const loading = page.getByText(/加载消歧会话|Loading disambiguation/i);
        try {
          await loading.waitFor({ state: "hidden", timeout: 20_000 });
        } catch {
          /* ok */
        }
        await page
          .getByTestId("disambiguation-table")
          .waitFor({ state: "visible", timeout: 20_000 });
        const reseed = page.getByTestId("disambiguation-reseed");
        if (await reseed.isVisible().catch(() => false)) {
          for (let i = 0; i < 40; i++) {
            if (await reseed.isEnabled().catch(() => false)) break;
            await page.waitForTimeout(250);
          }
          if (await reseed.isEnabled().catch(() => false)) {
            await reseed.click({ force: true });
            await pause(page, 1200);
          }
        }
        await pause(page, 500);
      },
    },
    {
      id: "das-candidate",
      vo: "第一种，候选选择。提问是：这条「冷却回路超温告警」规则，应该绑定哪台设备？咱们勾置信度更高的 1号循环泵。",
      caption: "候选选择：勾选「1号循环泵」",
      holdAfterMs: 400,
      focus: '[data-testid="disambiguation-choice-panel"]',
      focusScale: 2.0,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await dismissNextOverlay(page);
        const row = page.getByTestId("disambiguation-row-das-cooling-candidate");
        if (!(await row.isVisible().catch(() => false))) {
          throw new Error("missing row das-cooling-candidate");
        }
        await row.click({ force: true });
        await page
          .getByTestId("disambiguation-choice-panel")
          .waitFor({ state: "visible", timeout: 15_000 });
        const c = page.getByTestId("disambiguation-candidate-device-pump-01");
        if (await c.isVisible().catch(() => false)) {
          await c.check({ force: true });
        }
        await pause(page, 500);
      },
    },
    {
      id: "das-supplement",
      vo: "第二种，信息补充。规则草稿还缺告警通知渠道，人在这儿补上。比如写：值班群。补完，流程才能往下走。",
      caption: "信息补充：补告警通知渠道",
      holdAfterMs: 400,
      focus: '[data-testid="disambiguation-choice-panel"]',
      focusScale: 2.0,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await dismissNextOverlay(page);
        const row = page.getByTestId(
          "disambiguation-row-das-cooling-supplement",
        );
        if (!(await row.isVisible().catch(() => false))) {
          throw new Error("missing row das-cooling-supplement");
        }
        await row.click({ force: true });
        await page
          .getByTestId("disambiguation-choice-panel")
          .waitFor({ state: "visible", timeout: 15_000 });
        const ft = page.getByTestId("disambiguation-free-text");
        if (await ft.isVisible().catch(() => false)) {
          await ft.fill("一号车间东侧，运维通道已确认");
        }
        await pause(page, 500);
      },
    },
    {
      id: "das-conflict",
      vo: "第三种，冲突裁决。同一设备在两份台账里所属区域不一致，不能让 AI 悄悄合并。这里确认以「一车间冷却区」为准。",
      caption: "冲突裁决：确认一车间冷却区",
      holdAfterMs: 400,
      focus: '[data-testid="disambiguation-choice-panel"]',
      focusScale: 2.0,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await dismissNextOverlay(page);
        const row = page.getByTestId("disambiguation-row-das-cooling-conflict");
        if (!(await row.isVisible().catch(() => false))) {
          throw new Error("missing row das-cooling-conflict");
        }
        await row.click({ force: true });
        await page
          .getByTestId("disambiguation-choice-panel")
          .waitFor({ state: "visible", timeout: 15_000 });
        const c = page.getByTestId("disambiguation-candidate-zone-cooling-1");
        if (await c.isVisible().catch(() => false)) {
          await c.check({ force: true });
        }
        await pause(page, 500);
      },
    },
    {
      id: "graph-inc",
      vo: "再看图谱增量同步。源文档改了操作说明之后，变更会增量进图，不是每次整库重算。这样省成本，也更好追溯。",
      caption: "图谱增量同步：改了说明，图跟着更新",
      holdAfterMs: 320,
      focus: '[data-testid="graph-incremental-list"]',
      focusScale: 1.75,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/graph-incremental`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await dismissNextOverlay(page);
        await page
          .getByTestId("graph-incremental-page")
          .waitFor({ state: "visible", timeout: 30_000 });
        const loading = page.getByText(/加载图谱增量|Loading graph-incremental/i);
        try {
          await loading.waitFor({ state: "hidden", timeout: 20_000 });
        } catch {
          /* ok */
        }
        await page
          .getByTestId("graph-incremental-list")
          .waitFor({ state: "visible", timeout: 20_000 });
        const seedBtn = page.getByTestId("graph-incremental-seed");
        if (await seedBtn.isVisible().catch(() => false)) {
          await seedBtn.click();
          await pause(page, 1200);
        }
        await pause(page, 500);
      },
    },
    {
      id: "graph-inc-sync",
      vo: "点开示例运维说明源，触发一次同步。你看同步报告：改了什么、抽取出什么、发布了什么，一眼能看清。",
      caption: "同步报告：变更 / 抽取 / 已发布",
      holdAfterMs: 400,
      focus: '[data-testid="graph-incremental-sync-report"], [data-testid="graph-incremental-detail"]',
      focusScale: 1.95,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        const prefer = page.getByTestId(
          "graph-incremental-row-src-ops-note-valve",
        );
        if (await prefer.isVisible().catch(() => false)) {
          await prefer.click();
        } else {
          await page
            .locator('[data-testid="graph-incremental-table"] tbody tr')
            .first()
            .click();
        }
        await page
          .getByTestId("graph-incremental-detail")
          .waitFor({ state: "visible", timeout: 15_000 });
        await pause(page, 700);
        const syncBtn = page.getByTestId("graph-incremental-sync");
        if (await syncBtn.isVisible().catch(() => false)) {
          for (let i = 0; i < 40; i++) {
            if (await syncBtn.isEnabled().catch(() => false)) break;
            await page.waitForTimeout(250);
          }
          if (await syncBtn.isEnabled().catch(() => false)) {
            await syncBtn.click();
            await pause(page, 1600);
          } else {
            // Still show detail/report area even if sync is gated
            await syncBtn.click({ force: true }).catch(() => undefined);
            await pause(page, 800);
          }
        }
        const report = page.getByTestId("graph-incremental-sync-report");
        if (await report.isVisible().catch(() => false)) {
          await report.scrollIntoViewIfNeeded();
          await pause(page, 500);
        }
      },
    },
    {
      id: "graph-explorer",
      vo: "图谱探索是活的图视图。画布上是冷却回路设备与关系。咱们点开 1号循环泵，能直接看属性。旁边徽章会告诉你，图存在哪里，比如 Neo4j。",
      caption: "图谱探索：点「1号循环泵」看属性",
      holdAfterMs: 450,
      focus: '[data-testid="graph-explorer-detail"], [data-testid="graph-explorer-canvas"]',
      focusScale: 1.7,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${ADMIN_BASE}/admin/graph-explorer`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await dismissNextOverlay(page);
        await page
          .getByTestId("graph-explorer-page")
          .waitFor({ state: "visible", timeout: 60_000 })
          .catch(() => undefined);
        const loading = page.getByText(
          /Loading graph from GraphStore|正在从 GraphStore/i,
        );
        try {
          await loading.waitFor({ state: "hidden", timeout: 20_000 });
        } catch {
          /* ok */
        }
        const seedBtn = page.getByTestId("graph-explorer-seed");
        if (await seedBtn.isVisible().catch(() => false)) {
          try {
            await Promise.race([
              seedBtn.click(),
              page.waitForTimeout(5000),
            ]);
            await pause(page, 800);
          } catch {
            /* seed may fail without Python GraphStore; file store already Chinese */
          }
        }
        await page
          .getByTestId("graph-explorer-canvas")
          .waitFor({ state: "visible", timeout: 30_000 });
        await pause(page, 1200);
        const pump = page.getByTestId(
          "graph-explorer-node-device-pump-01",
        );
        if (await pump.isVisible().catch(() => false)) {
          await pump
            .locator("circle")
            .click({ force: true })
            .catch(async () => {
              await pump.click({ force: true });
            });
          await pause(page, 1100);
          const detail = page.getByTestId("graph-explorer-detail");
          if (await detail.isVisible().catch(() => false)) {
            await detail.scrollIntoViewIfNeeded();
            await pause(page, 600);
          }
        }
        const badge = page.getByTestId("graph-explorer-backend");
        if (await badge.isVisible().catch(() => false)) {
          await badge.scrollIntoViewIfNeeded();
          await pause(page, 400);
        }
      },
    },
    {
      id: "portal-login",
      vo: "管理台给治理同学用。一线同事呢，在门户对话工作区也能做同样确认。咱们切到门户。",
      caption: "门户：一线同事也能确认歧义、核对出处",
      holdAfterMs: 220,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await portalLogin(page);
      },
    },
    {
      id: "portal-das-candidate",
      vo: "门户消歧面板，同样三种模式。先看候选选择：业务同事勾选 1号循环泵，不用进管理台，也能完成确认。",
      caption: "门户消歧：勾选「1号循环泵」",
      holdAfterMs: 350,
      focus: '[data-testid="portal-disambiguation-choice-panel"]',
      focusScale: 1.95,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${PORTAL_BASE}/workspace/disambiguation`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await dismissNextOverlay(page);
        await page
          .getByTestId("portal-disambiguation-page")
          .waitFor({ state: "visible", timeout: 30_000 });
        const reseed = page.getByTestId("portal-disambiguation-reseed");
        if (await reseed.isVisible().catch(() => false)) {
          for (let i = 0; i < 40; i++) {
            if (await reseed.isEnabled().catch(() => false)) break;
            await page.waitForTimeout(250);
          }
          if (await reseed.isEnabled().catch(() => false)) {
            await reseed.click({ force: true });
            await pause(page, 1200);
          }
        }
        await dismissNextOverlay(page);
        let row = page.getByTestId(
          "portal-disambiguation-row-das-cooling-candidate",
        );
        for (let i = 0; i < 30; i++) {
          if (await row.isVisible().catch(() => false)) break;
          await page.waitForTimeout(300);
          row = page.getByTestId(
            "portal-disambiguation-row-das-cooling-candidate",
          );
        }
        if (!(await row.isVisible().catch(() => false))) {
          // Fallback: first table row (SAMPLE may still be loading)
          row = page.locator(
            '[data-testid="portal-disambiguation-table"] tbody tr',
          ).first();
        }
        if (!(await row.isVisible().catch(() => false))) {
          throw new Error("missing portal row das-cooling-candidate");
        }
        await row.click({ force: true });
        await page
          .getByTestId("portal-disambiguation-choice-panel")
          .waitFor({ state: "visible", timeout: 15_000 });
        const c = page.getByTestId(
          "portal-disambiguation-candidate-device-pump-01",
        );
        if (await c.isVisible().catch(() => false)) {
          await c.check({ force: true });
        }
        await pause(page, 500);
      },
    },
    {
      id: "portal-das-supplement",
      vo: "信息补充这边也一样。缺告警通知渠道，就在门户里补上。比如：值班群。",
      caption: "门户：信息补充",
      holdAfterMs: 320,
      focus: '[data-testid="portal-disambiguation-choice-panel"]',
      focusScale: 1.95,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await dismissNextOverlay(page);
        let row = page.getByTestId(
          "portal-disambiguation-row-das-cooling-supplement",
        );
        for (let i = 0; i < 30; i++) {
          if (await row.isVisible().catch(() => false)) break;
          await page.waitForTimeout(300);
          row = page.getByTestId(
            "portal-disambiguation-row-das-cooling-supplement",
          );
        }
        if (!(await row.isVisible().catch(() => false))) {
          row = page.locator(
            '[data-testid="portal-disambiguation-table"] tbody tr',
          ).first();
        }
        if (!(await row.isVisible().catch(() => false))) {
          throw new Error("missing portal row das-cooling-supplement");
        }
        await row.click({ force: true });
        await page
          .getByTestId("portal-disambiguation-choice-panel")
          .waitFor({ state: "visible", timeout: 15_000 });
        const ft = page.getByTestId("portal-disambiguation-free-text");
        if (await ft.isVisible().catch(() => false)) {
          await ft.fill("一号车间东侧，运维通道已确认");
        }
        await pause(page, 500);
      },
    },
    {
      id: "portal-das-conflict",
      vo: "冲突裁决也在门户完成。人选「一车间冷却区」，AI 不会偷偷合并。一线同学自己就能拍板。",
      caption: "门户：冲突裁决",
      holdAfterMs: 320,
      focus: '[data-testid="portal-disambiguation-choice-panel"]',
      focusScale: 1.95,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await dismissNextOverlay(page);
        let row = page.getByTestId(
          "portal-disambiguation-row-das-cooling-conflict",
        );
        for (let i = 0; i < 30; i++) {
          if (await row.isVisible().catch(() => false)) break;
          await page.waitForTimeout(300);
          row = page.getByTestId(
            "portal-disambiguation-row-das-cooling-conflict",
          );
        }
        if (!(await row.isVisible().catch(() => false))) {
          row = page.locator(
            '[data-testid="portal-disambiguation-table"] tbody tr',
          ).first();
        }
        if (!(await row.isVisible().catch(() => false))) {
          throw new Error("missing portal row das-cooling-conflict");
        }
        await row.click({ force: true });
        await page
          .getByTestId("portal-disambiguation-choice-panel")
          .waitFor({ state: "visible", timeout: 15_000 });
        const c = page.getByTestId(
          "portal-disambiguation-candidate-zone-cooling-1",
        );
        if (await c.isVisible().catch(() => false)) {
          await c.check({ force: true });
        }
        await pause(page, 500);
      },
    },
    {
      id: "portal-citations",
      vo: "最后看出处与证据页。答案不能只给结论。还要能核对出处，看见冲突和缺失。一线同事也能在这里验真。",
      caption: "出处/证据：答案可核对，冲突与缺失可见",
      holdAfterMs: 400,
      focus: '[data-testid="citation-evidence-panel"], [data-testid="portal-citations-page"]',
      focusScale: 1.8,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.goto(`${PORTAL_BASE}/workspace/citations`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page
          .getByTestId("portal-citations-page")
          .waitFor({ state: "visible", timeout: 30_000 });
        const panel = page.getByTestId("citation-evidence-panel");
        if (await panel.isVisible().catch(() => false)) {
          await panel.scrollIntoViewIfNeeded();
        }
        await pause(page, 800);
      },
    },
    {
      id: "closing",
      vo: "简单收个尾。规则可治理，知识有生命周期和质检，歧义由人确认，图谱能增量同步也能探索。这就是 AgenticX 规则与知识套件，要解决的企业级可信问题。谢谢各位。",
      caption: "规则可治 · 知识可溯 · 歧义可确认 · 图谱可同步",
      holdAfterMs: 450,
      run: async (page) => {
        await zoomOut(page, { durationMs: 400 }).catch(() => undefined);
        await page.setContent(
          `<!doctype html><html><head><meta charset="utf-8"/><style>
            html,body{margin:0;height:100%;background:#0b1220;color:#f8fafc;font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif}
            .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:48px;text-align:center;gap:18px}
            h1{font-size:38px;margin:0}
            p{font-size:23px;line-height:1.8;max-width:920px;margin:0;opacity:.92}
          </style></head><body><div class="wrap">
            <h1>规则可治 · 知识可溯 · 歧义可确认 · 图谱可同步</h1>
            <p>AgenticX 规则与知识套件 · 企业级可信 AI 底座能力</p>
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
  // Allow comma-separated fallbacks
  const parts = focus.split(",").map((s) => s.trim()).filter(Boolean);
  for (const sel of parts) {
    const ok = await page.locator(sel).first().isVisible().catch(() => false);
    if (ok) return sel;
  }
  return null;
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_MP4), { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rk-ops-demo-"));
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
    `[demo] viewport=${VW}x${VH} deviceScaleFactor=${DEVICE_SCALE} camera=css-transform zoomTo/zoomOut`,
  );

  const cues = buildCues();

  // Pre-generate TTS to know hold durations
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
        // Documentary beat: zoom into local subject before VO hold
        if (cue.focus) {
          const sel = await resolveFocusSelector(page, cue.focus);
          if (sel) {
            await zoomTo(page, sel, {
              scale: cue.focusScale ?? 1.85,
              durationMs: 850,
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
        // Pull back to global before next navigation/click
        if (cue.focus) {
          await zoomOut(page, { durationMs: 700 });
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
  console.log(`[demo] srt written ${srtPath}`);

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
  console.log(`camera=css-transform zoomTo/zoomOut`);
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
