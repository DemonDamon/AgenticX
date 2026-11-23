/**
 * SP6 unit tests — enterprise browser-deny list distribution.
 *
 * Covers the desktop side of the private-deployment deny channel:
 *   - readEnterpriseBrowserDenyDomains: AGX_HOME/config.yaml →
 *     enterprise.browser_deny_domains (missing section/entries → []),
 *     normalization (trim/lowercase, drop empties);
 *   - startNmSocketServer pong piggyback: every pong carries the provider's
 *     current list (also empty, so config removals propagate), and the shape
 *     is untouched when no provider is wired (e2e/mock compatibility).
 *
 * The extension-side matcher semantics live with the extension sources
 * (extension/src/safety/domains.js — node-testable via module.exports; the
 * J5 e2e asserts the end-to-end deny behavior with the built-in list).
 *
 * electron is mocked (vitest runs under plain node).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: () => {}, removeHandler: () => {} },
  webContents: { fromId: () => null },
}));

import { refreshAgxHomeCache } from "../electron/agx-home";
import { readEnterpriseBrowserDenyDomains } from "../electron/browser-bridge";
import { startNmSocketServer } from "../electron/nm-socket-server";

// Extension-side matcher: plain classic script with a node test hook
// (module.exports tail in extension/src/safety/domains.js).
const nodeRequire = createRequire(import.meta.url);
const extensionDomains = nodeRequire("../../extension/src/safety/domains.js") as {
  AGX_ENTERPRISE_DENY_KEY: string;
  AGX_SENSITIVE_DOMAIN_PATTERNS: { category: string; pattern: string }[];
  agxMatchEnterpriseDenyDomain: (hostname: string, patterns: string[]) => { category: string; pattern: string } | null;
  agxMatchSensitiveDomain: (hostname: string) => { category: string; pattern: string } | null;
  agxSensitiveDomainVerdict: (
    action: string,
    target: { url?: string; tab_url?: string },
  ) => Promise<{ domain: string; category: string; tab_url: string } | null>;
};

describe("SP6 enterprise deny list · readEnterpriseBrowserDenyDomains", () => {
  let tmpHome: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agx-deny-test-"));
    savedEnv = process.env.AGX_HOME;
    process.env.AGX_HOME = tmpHome;
    refreshAgxHomeCache();
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.AGX_HOME;
    else process.env.AGX_HOME = savedEnv;
    refreshAgxHomeCache();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns [] when config.yaml is absent", () => {
    expect(readEnterpriseBrowserDenyDomains()).toEqual([]);
  });

  it("returns [] when the enterprise section / list is absent", () => {
    fs.writeFileSync(path.join(tmpHome, "config.yaml"), "version: '1'\n", "utf-8");
    expect(readEnterpriseBrowserDenyDomains()).toEqual([]);
    fs.writeFileSync(
      path.join(tmpHome, "config.yaml"),
      ["version: '1'", "enterprise:", "  enabled: true", "  token: t", ""].join("\n"),
      "utf-8",
    );
    expect(readEnterpriseBrowserDenyDomains()).toEqual([]);
  });

  it("reads + normalizes enterprise.browser_deny_domains", () => {
    fs.writeFileSync(
      path.join(tmpHome, "config.yaml"),
      [
        "version: '1'",
        "enterprise:",
        "  enabled: true",
        "  token: t",
        "  browser_deny_domains:",
        "    - InternalPortal.Corp",
        "    - '  example.com  '",
        "    - ''",
        "    - 42",
        "",
      ].join("\n"),
      "utf-8",
    );
    expect(readEnterpriseBrowserDenyDomains()).toEqual(["internalportal.corp", "example.com", "42"]);
  });

  it("ignores non-array entries", () => {
    fs.writeFileSync(
      path.join(tmpHome, "config.yaml"),
      ["version: '1'", "enterprise:", "  browser_deny_domains: oops", ""].join("\n"),
      "utf-8",
    );
    expect(readEnterpriseBrowserDenyDomains()).toEqual([]);
  });
});

describe("SP6 enterprise deny list · pong piggyback", () => {
  let tmpSocket: string;

  beforeEach(() => {
    tmpSocket = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agx-nm-pong-")), "nm.sock");
  });

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(tmpSocket), { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  });

  function sendLine(socketPath: string, line: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const client = net.connect(socketPath);
      let buffer = "";
      client.on("connect", () => client.write(`${line}\n`));
      client.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const newline = buffer.indexOf("\n");
        if (newline !== -1) {
          client.destroy();
          resolve(buffer.slice(0, newline));
        }
      });
      client.on("error", reject);
    });
  }

  it("attaches the provider's list to every pong (including empty)", async () => {
    let current = ["corp.example.com"];
    const server = await startNmSocketServer(tmpSocket, {
      enterpriseDenyDomains: () => current,
    });
    try {
      const pong = JSON.parse(
        await sendLine(tmpSocket, JSON.stringify({ type: "ping", ts: 1 })),
      ) as Record<string, unknown>;
      expect(pong.type).toBe("pong");
      expect(pong.ts).toBe(1);
      expect(pong.enterprise_deny_domains).toEqual(["corp.example.com"]);

      // Provider output changes (config edit) propagate on the NEXT pong.
      current = [];
      const cleared = JSON.parse(
        await sendLine(tmpSocket, JSON.stringify({ type: "ping", ts: 2 })),
      ) as Record<string, unknown>;
      expect(cleared.enterprise_deny_domains).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("keeps the pong shape untouched without a provider", async () => {
    const server = await startNmSocketServer(tmpSocket);
    try {
      const pong = JSON.parse(
        await sendLine(tmpSocket, JSON.stringify({ type: "ping", ts: 7 })),
      ) as Record<string, unknown>;
      expect(pong).toEqual({ type: "pong", ts: 7 });
    } finally {
      await server.close();
    }
  });
});

describe("SP6 enterprise deny list · extension-side semantics", () => {
  const storageData: Record<string, unknown> = {};
  const chromeStub = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storageData[key] }),
      },
    },
  };

  beforeEach(() => {
    for (const key of Object.keys(storageData)) delete storageData[key];
    vi.stubGlobal("chrome", chromeStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("agxMatchEnterpriseDenyDomain: exact / parent-domain / miss", () => {
    const patterns = ["corp.example.com"];
    expect(extensionDomains.agxMatchEnterpriseDenyDomain("corp.example.com", patterns)).toEqual({
      category: "enterprise",
      pattern: "corp.example.com",
    });
    expect(extensionDomains.agxMatchEnterpriseDenyDomain("portal.corp.example.com", patterns)).toEqual({
      category: "enterprise",
      pattern: "corp.example.com",
    });
    expect(extensionDomains.agxMatchEnterpriseDenyDomain("fakecorp.example.com", patterns)).toBeNull();
    expect(extensionDomains.agxMatchEnterpriseDenyDomain("", patterns)).toBeNull();
    expect(extensionDomains.agxMatchEnterpriseDenyDomain("corp.example.com", [])).toBeNull();
  });

  it("verdict: enterprise hits are final — an options-page allow cannot un-block them", async () => {
    storageData[extensionDomains.AGX_ENTERPRISE_DENY_KEY] = ["corp.example.com"];
    storageData["agx_safety_allow"] = { "corp.example.com": 1 };
    const verdict = await extensionDomains.agxSensitiveDomainVerdict("open", {
      url: "https://portal.corp.example.com/x",
    });
    expect(verdict).toEqual({
      domain: "portal.corp.example.com",
      category: "enterprise",
      tab_url: "https://portal.corp.example.com/x",
    });
  });

  it("verdict: built-in hits still honor the options-page allow list", async () => {
    delete storageData[extensionDomains.AGX_ENTERPRISE_DENY_KEY];
    storageData["agx_safety_allow"] = { "www.icbc.com.cn": 1 };
    expect(
      await extensionDomains.agxSensitiveDomainVerdict("open", { url: "https://www.icbc.com.cn/" }),
    ).toBeNull();
    delete storageData["agx_safety_allow"];
    const blocked = await extensionDomains.agxSensitiveDomainVerdict("open", {
      url: "https://www.icbc.com.cn/",
    });
    expect(blocked?.category).toBe("banking");
  });

  it("verdict: non-listed hosts pass clean", async () => {
    storageData[extensionDomains.AGX_ENTERPRISE_DENY_KEY] = ["corp.example.com"];
    expect(
      await extensionDomains.agxSensitiveDomainVerdict("open", { url: "https://example.org/" }),
    ).toBeNull();
  });
});
