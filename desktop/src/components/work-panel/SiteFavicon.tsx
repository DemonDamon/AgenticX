/**
 * Site favicon with Globe fallback (WorkPanel「参考信息」web rows).
 *
 * In Electron, favicons are fetched in the main process (proxyAwareFetch) and
 * returned as data URLs. Renderer <img src="https://..."> ignores HTTPS_PROXY,
 * so CDN loads fail under Clash/env-only proxy and every row falls back to Globe.
 *
 * Author: Damon Li
 */

import { useEffect, useMemo, useState } from "react";
import { Globe } from "lucide-react";
import {
  classifyFaviconPixels,
  hostnameFromUrlOrDomain,
  resolveFaviconCandidates,
  type FaviconTone,
} from "../../utils/favicon-url";

type Props = {
  url?: string;
  domain?: string;
  className?: string;
  size?: number;
};

type UsableTone = Exclude<FaviconTone, "empty">;
type CacheEntry =
  | { status: "ok"; dataUrl: string; tone: UsableTone }
  | { status: "fail" };

function inspectFaviconDataUrl(dataUrl: string): Promise<FaviconTone> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const width = Math.max(1, Math.min(img.naturalWidth || 16, 32));
        const height = Math.max(1, Math.min(img.naturalHeight || 16, 32));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve("normal");
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(classifyFaviconPixels(ctx.getImageData(0, 0, width, height).data));
      } catch {
        resolve("normal");
      }
    };
    img.onerror = () => resolve("empty");
    img.src = dataUrl;
  });
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function cacheKey(url?: string, domain?: string, size = 32): string {
  const host =
    hostnameFromUrlOrDomain(domain || "") || hostnameFromUrlOrDomain(url || "");
  return `${host}|${size}`;
}

async function loadViaIpc(
  url: string | undefined,
  domain: string | undefined,
  size: number,
): Promise<CacheEntry> {
  const desktop = window.agenticxDesktop;
  if (!desktop?.fetchFavicon) return { status: "fail" };
  try {
    const result = await desktop.fetchFavicon({ url, domain, size });
    if (result.ok && result.dataUrl) {
      const tone = await inspectFaviconDataUrl(result.dataUrl);
      if (tone === "empty") return { status: "fail" };
      return { status: "ok", dataUrl: result.dataUrl, tone };
    }
  } catch {
    // fall through
  }
  return { status: "fail" };
}

function loadFavicon(
  url: string | undefined,
  domain: string | undefined,
  size: number,
): Promise<CacheEntry> {
  const key = cacheKey(url, domain, size);
  if (!hostnameFromUrlOrDomain(domain || "") && !hostnameFromUrlOrDomain(url || "")) {
    return Promise.resolve({ status: "fail" });
  }
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = loadViaIpc(url, domain, size).then((entry) => {
    cache.set(key, entry);
    inflight.delete(key);
    return entry;
  });
  inflight.set(key, job);
  return job;
}

export function SiteFavicon({
  url,
  domain,
  className = "h-3.5 w-3.5",
  size = 32,
}: Props) {
  const key = useMemo(() => cacheKey(url, domain, size), [url, domain, size]);
  const hasElectronIpc = typeof window !== "undefined" && !!window.agenticxDesktop?.fetchFavicon;
  const [dataUrl, setDataUrl] = useState<string | null>(() => {
    const hit = cache.get(key);
    return hit?.status === "ok" ? hit.dataUrl : null;
  });
  const [tone, setTone] = useState<UsableTone>(() => {
    const hit = cache.get(key);
    return hit?.status === "ok" ? hit.tone : "normal";
  });
  const [failed, setFailed] = useState(() => cache.get(key)?.status === "fail");

  // Direct CDN fallback only when not running under Electron IPC (e.g. browser).
  const [cdnIndex, setCdnIndex] = useState(0);
  const cdnCandidates = useMemo(
    () => (hasElectronIpc ? [] : resolveFaviconCandidates(url, domain, size)),
    [hasElectronIpc, url, domain, size],
  );

  useEffect(() => {
    const hit = cache.get(key);
    if (hit?.status === "ok") {
      setDataUrl(hit.dataUrl);
      setTone(hit.tone);
      setFailed(false);
      return;
    }
    if (hit?.status === "fail") {
      setDataUrl(null);
      setTone("normal");
      setFailed(true);
      return;
    }

    setDataUrl(null);
    setTone("normal");
    setFailed(false);
    setCdnIndex(0);

    if (!hasElectronIpc) return;

    let cancelled = false;
    void loadFavicon(url, domain, size).then((entry) => {
      if (cancelled) return;
      if (entry.status === "ok") {
        setDataUrl(entry.dataUrl);
        setTone(entry.tone);
        setFailed(false);
      } else {
        setDataUrl(null);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key, hasElectronIpc, url, domain, size]);

  if (dataUrl) {
    const img = (
      <img
        src={dataUrl}
        alt=""
        className={`${className} rounded-sm object-contain`}
        draggable={false}
        decoding="async"
      />
    );
    if (tone === "light") {
      return (
        <span
          className={`inline-flex items-center justify-center overflow-hidden rounded-full bg-neutral-800 ${className}`}
        >
          <img
            src={dataUrl}
            alt=""
            className="h-full w-full object-contain"
            draggable={false}
            decoding="async"
          />
        </span>
      );
    }
    return img;
  }

  if (!hasElectronIpc && !failed && cdnCandidates.length > 0) {
    const src = cdnCandidates[cdnIndex];
    if (src) {
      return (
        <span className={`relative inline-flex shrink-0 ${className}`} aria-hidden>
          <Globe className={className} strokeWidth={1.7} />
          <img
            key={src}
            src={src}
            alt=""
            className={`${className} absolute inset-0 rounded-sm object-contain opacity-0`}
            draggable={false}
            loading="eager"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={(e) => {
              const el = e.currentTarget as HTMLImageElement;
              void inspectFaviconDataUrl(src).then((nextTone) => {
                if (nextTone === "empty") {
                  if (cdnIndex + 1 < cdnCandidates.length) {
                    setCdnIndex((i) => i + 1);
                    return;
                  }
                  cache.set(key, { status: "fail" });
                  setFailed(true);
                  return;
                }
                cache.set(key, { status: "ok", dataUrl: src, tone: nextTone });
                el.style.opacity = "1";
                setTone(nextTone);
                setDataUrl(src);
              });
            }}
            onError={() => {
              if (cdnIndex + 1 < cdnCandidates.length) {
                setCdnIndex((i) => i + 1);
              } else {
                setFailed(true);
              }
            }}
          />
        </span>
      );
    }
  }

  return <Globe className={className} strokeWidth={1.7} aria-hidden />;
}
