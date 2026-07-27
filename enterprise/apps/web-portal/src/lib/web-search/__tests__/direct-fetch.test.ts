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
});
