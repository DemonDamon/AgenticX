import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { RequestListener } from "node:http";
import { createServer, request, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadSkillBody } from "../enterprise-skill-bundle";
import { downloadSkillBytes, isAllowedSkillAddress, SKILL_BUNDLE_MAX_BYTES, type SkillHttpsRequest } from "../skill-bundle-transport";

let directory: string;
let key: Buffer;
let cert: Buffer;
const servers: Server[] = [];
const resolveLoopback = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
const trustedRequest: SkillHttpsRequest = (url, options, onResponse) => request(url, { ...options, ca: cert }, onResponse);
const options = () => ({ resolveAddresses: resolveLoopback, requestImpl: trustedRequest });

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "skill-download-test-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=cdn.example.com", "-addext", "subjectAltName=DNS:cdn.example.com",
    "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem")], { stdio: "ignore" });
  key = readFileSync(join(directory, "key.pem")); cert = readFileSync(join(directory, "cert.pem"));
});
afterEach(async () => {
  vi.useRealTimers(); vi.clearAllMocks();
  delete process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST;
  delete process.env.ENTERPRISE_SKILL_BUNDLE_ALLOW_PRIVATE_NETWORK;
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function endpoint(listener: RequestListener): Promise<string> {
  const server = createServer({ key, cert }, listener); servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "cdn.example.com";
  process.env.ENTERPRISE_SKILL_BUNDLE_ALLOW_PRIVATE_NETWORK = "true";
  return "https://cdn.example.com:" + (server.address() as AddressInfo).port + "/SKILL.md";
}

describe("skill address policy", () => {
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.100.100.200", "192.168.1.1", "::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "fe80::1", "fec0::1", "fc00::1", "64:ff9b::a00:1",
    "2002:7f00:1::", "not-an-address"])("rejects non-public address %s", (address) => {
    expect(isAllowedSkillAddress(address)).toBe(false);
  });
  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("accepts public address %s", (address) => {
    expect(isAllowedSkillAddress(address)).toBe(true);
  });
  it("allows explicit private sources but still blocks metadata", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "::1", "::ffff:10.0.0.1", "fc00::1"])
      expect(isAllowedSkillAddress(address, true)).toBe(true);
    for (const address of ["169.254.169.254", "::ffff:169.254.169.254", "fe80::1", "100.100.100.200", "fd00:ec2::254", "fd20:ce::254"])
      expect(isAllowedSkillAddress(address, true)).toBe(false);
  });
});

describe("loadSkillBody over real TLS", () => {
  it("rejects non-https, userinfo, fragments and unlisted hosts before DNS", async () => {
    process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "cdn.example.com";
    for (const url of ["http://cdn.example.com/a", "https://user:pass@cdn.example.com/a", // gitleaks:allow
      "https://cdn.example.com/a#fragment", "https://evil.example/a"])
      expect(await loadSkillBody(url, options())).toBeNull();
    expect(resolveLoopback).not.toHaveBeenCalled();
  });
  it("validates original bytes before stripping frontmatter", async () => {
    const body = "---\nname: x\n---\n步骤";
    const url = await endpoint((_, response) => response.end(body));
    const digest = createHash("sha256").update(body).digest("hex");
    expect(await loadSkillBody(url, { ...options(), expectedDigest: "sha256:" + digest })).toBe("步骤");
    expect(await loadSkillBody(url, { ...options(), expectedDigest: digest })).toBe("步骤");
    expect(await loadSkillBody(url, { ...options(), expectedDigest: "0".repeat(64) })).toBeNull();
    expect(await loadSkillBody(url, { ...options(), expectedDigest: "invalid" })).toBeNull();
    expect(await loadSkillBody(url, { ...options(), expectedDigest: "sha256:" })).toBeNull();
  });
  it("retains legacy records without a digest", async () => {
    const url = await endpoint((_, response) => response.end("body"));
    expect(await loadSkillBody(url, options())).toBe("body");
  });
  it("pins DNS once and preserves TLS hostname and Host", async () => {
    let servername: string | false | null | undefined; let host: string | undefined;
    const url = await endpoint((req, response) => {
      servername = (req.socket as TLSSocket).servername; host = req.headers.host; response.end("safe");
    });
    const resolver = vi.fn().mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
      .mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    expect(await loadSkillBody(url, { ...options(), resolveAddresses: resolver })).toBe("safe");
    expect(resolver).toHaveBeenCalledTimes(1); expect(servername).toBe("cdn.example.com");
    expect(host).toBe(new URL(url).host);
  });
  it("keeps certificate trust and hostname verification enabled", async () => {
    const url = await endpoint((_, response) => response.end("must not trust"));
    expect(await loadSkillBody(url, { resolveAddresses: resolveLoopback })).toBeNull();
    process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "wrong.example.com";
    expect(await loadSkillBody(url.replace("cdn.example.com", "wrong.example.com"), options())).toBeNull();
  });
  it("rejects mixed DNS answers before a socket is opened", async () => {
    process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "cdn.example.com";
    const requestImpl = vi.fn();
    expect(await loadSkillBody("https://cdn.example.com/a", {
      resolveAddresses: async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }], requestImpl,
    })).toBeNull();
    expect(requestImpl).not.toHaveBeenCalled();
  });
  it("requires private-network opt-in", async () => {
    const url = await endpoint((_, response) => response.end("private"));
    delete process.env.ENTERPRISE_SKILL_BUNDLE_ALLOW_PRIVATE_NETWORK;
    expect(await loadSkillBody(url, options())).toBeNull();
  });
  it.each([302, 404, 500])("rejects HTTP %i without following redirects", async (status) => {
    let requests = 0;
    const url = await endpoint((_, response) => {
      requests++; response.writeHead(status, { location: "https://cdn.example.com/next" }); response.end("no");
    });
    expect(await loadSkillBody(url, options())).toBeNull(); expect(requests).toBe(1);
  });
  it("rejects Content-Length above the byte limit", async () => {
    const url = await endpoint((_, response) => {
      response.writeHead(200, { "content-length": SKILL_BUNDLE_MAX_BYTES + 1 }); response.end("short");
    });
    expect(await loadSkillBody(url, options())).toBeNull();
  });
  it("bounds chunked bytes including multibyte text", async () => {
    const url = await endpoint((_, response) => {
      response.writeHead(200); response.write("文".repeat(8_000)); response.end("文");
    });
    expect(await loadSkillBody(url, options())).toBeNull();
  });
  it("accepts exactly the maximum bytes", async () => {
    const body = "a".repeat(SKILL_BUNDLE_MAX_BYTES);
    const url = await endpoint((_, response) => response.end(body));
    expect(await loadSkillBody(url, options())).toBe(body);
  });
  it("interrupts slow bodies at the shared deadline", async () => {
    const url = await endpoint((_, response) => { response.writeHead(200); response.write("first"); });
    await expect(downloadSkillBytes(new URL(url), AbortSignal.timeout(80), { ...options(), allowPrivate: true })).rejects.toThrow();
  });
  it("closes the actual TLS socket when a slow body is aborted", async () => {
    let markClosed!: () => void;
    const closed = new Promise<void>((resolve) => { markClosed = resolve; });
    const url = await endpoint((req, response) => {
      req.socket.once("close", markClosed);
      response.writeHead(200);
      response.write("prefix");
    });
    await expect(downloadSkillBytes(new URL(url), AbortSignal.timeout(80), { ...options(), allowPrivate: true })).rejects.toThrow();
    await closed;
  });
  it("does not open a socket for a DNS answer that arrives after abort", async () => {
    let answer!: (addresses: { address: string; family: number }[]) => void;
    const pending = new Promise<{ address: string; family: number }[]>((resolve) => { answer = resolve; });
    const requestImpl = vi.fn();
    const controller = new AbortController();
    const download = downloadSkillBytes(new URL("https://cdn.example.com/a"), controller.signal, {
      resolveAddresses: () => pending,
      requestImpl,
    });
    controller.abort(new Error("synthetic cancellation"));
    await expect(download).rejects.toThrow("synthetic cancellation");
    answer([{ address: "8.8.8.8", family: 4 }]);
    await Promise.resolve();
    expect(requestImpl).not.toHaveBeenCalled();
  });
  it("includes stalled DNS in the total deadline", async () => {
    vi.useFakeTimers(); process.env.ENTERPRISE_SKILL_BUNDLE_HOST_ALLOWLIST = "cdn.example.com";
    const result = loadSkillBody("https://cdn.example.com/a", { resolveAddresses: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(2500); expect(await result).toBeNull();
  });
});
