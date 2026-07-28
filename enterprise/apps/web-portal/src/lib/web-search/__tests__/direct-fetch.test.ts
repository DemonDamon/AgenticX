import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { directFetch, resolveHttpProxyUrl } from "../direct-fetch";

describe("directFetch", () => {
  it("resolves http(s) proxy urls and skips socks", () => {
    expect(
      resolveHttpProxyUrl({
        all_proxy: "socks5://127.0.0.1:7897",
        https_proxy: "http://127.0.0.1:7897",
      })?.toString(),
    ).toBe("http://127.0.0.1:7897/");
    expect(resolveHttpProxyUrl({ all_proxy: "socks5://127.0.0.1:7897" })).toBeNull();
  });

  it("POSTs and returns body (curl or node fallback)", async () => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(`ok:${req.method}:${raw}`);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const url = `http://127.0.0.1:${addr.port}/echo`;

    try {
      const res = await directFetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "q=hello",
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok:POST:q=hello");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("honors timeoutMs for hung upstream (does not wait ~20s)", async () => {
    const server = createServer((_req, _res) => {
      // never respond
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const url = `http://127.0.0.1:${addr.port}/hang`;

    try {
      const started = Date.now();
      await expect(
        directFetch(url, {
          method: "GET",
          timeoutMs: 400,
          signal: AbortSignal.timeout(400),
        }),
      ).rejects.toBeTruthy();
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("preserves binary bodies with high bytes (favicon PNG)", async () => {
    // Real PNG magic starts with 0x89; UTF-8 string decode would turn it into EF BF BD.
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x80, 0xff, 0xfe, 0xfd, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
    ]);
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(png);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const url = `http://127.0.0.1:${addr.port}/icon.png`;

    try {
      const res = await directFetch(url, { method: "GET" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/image\/png/i);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf[0]).toBe(0x89);
      expect(buf.equals(png)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
