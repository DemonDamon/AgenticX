import { describe, expect, it, vi } from "vitest";
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

  it("keeps application/json content-type so JSON providers do not get HTTP 415", async () => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ contentType: req.headers["content-type"] ?? null, raw }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const body = JSON.stringify({ query: "广州南沙天气如何", summary: true, freshness: "oneDay" });

    try {
      const res = await directFetch(`http://127.0.0.1:${addr.port}/v1/web-search`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer k" },
        body,
      });
      const json = (await res.json()) as { contentType: string | null; raw: string };
      expect(json.contentType).toMatch(/application\/json/i);
      expect(json.raw).toBe(body);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("still sends search forms as x-www-form-urlencoded (DuckDuckGo path unchanged)", async () => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ contentType: req.headers["content-type"] ?? null, raw }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");

    try {
      const res = await directFetch(`http://127.0.0.1:${addr.port}/html/`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ q: "hello" }).toString(),
      });
      const json = (await res.json()) as { contentType: string | null; raw: string };
      expect(json.contentType).toMatch(/application\/x-www-form-urlencoded/i);
      expect(json.raw).toBe("q=hello");
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
        }),
      ).rejects.toBeTruthy();
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("bounds fallback paths with timeoutMs even when signal never fires", async () => {
    vi.stubEnv("HTTPS_PROXY", "");
    vi.stubEnv("HTTP_PROXY", "");
    vi.stubEnv("ALL_PROXY", "");
    vi.stubEnv("https_proxy", "");
    vi.stubEnv("http_proxy", "");
    vi.stubEnv("all_proxy", "");

    const server = createServer((_req, _res) => {
      // never respond — force timeout on requestDirect fallback
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const url = `http://127.0.0.1:${addr.port}/hang-forever`;

    try {
      const started = Date.now();
      // Never-aborting signal mirrors production runSignal (never fired by design).
      await expect(
        directFetch(url, {
          method: "GET",
          timeoutMs: 400,
          signal: new AbortController().signal,
        }),
      ).rejects.toBeTruthy();
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      vi.unstubAllEnvs();
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

  it("aborts responses that exceed the configured byte limit", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ payload: "x".repeat(4_096) }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");

    try {
      await expect(
        directFetch(`http://127.0.0.1:${addr.port}/large`, {
          maxResponseBytes: 256,
        }),
      ).rejects.toThrow(/exceeded/i);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
