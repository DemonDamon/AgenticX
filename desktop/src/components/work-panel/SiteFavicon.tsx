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
  hostnameFromUrlOrDomain,
  resolveFaviconCandidates,
} from "../../utils/favicon-url";

type Props = {
  url?: string;
  domain?: string;
  className?: string;
  size?: number;
};

type CacheEntry = { status: "ok"; dataUrl: string } | { status: "fail" };

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
    if (result.ok && result.dataUrl) return { status: "ok", dataUrl: result.dataUrl };
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
      setFailed(false);
      return;
    }
    if (hit?.status === "fail") {
      setDataUrl(null);
      setFailed(true);
      return;
    }

    setDataUrl(null);
    setFailed(false);
    setCdnIndex(0);

    if (!hasElectronIpc) return;

    let cancelled = false;
    void loadFavicon(url, domain, size).then((entry) => {
      if (cancelled) return;
      if (entry.status === "ok") {
        setDataUrl(entry.dataUrl);
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
    return (
      <img
        src={dataUrl}
        alt=""
        className={`${className} rounded-sm object-contain`}
        draggable={false}
        decoding="async"
      />
    );
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
              (e.currentTarget as HTMLImageElement).style.opacity = "1";
              setDataUrl(src);
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
