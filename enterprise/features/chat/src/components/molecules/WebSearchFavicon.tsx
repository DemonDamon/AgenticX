"use client";

import * as React from "react";
import { hostVariants, resolveFaviconCandidates } from "../../utils/favicon-url";

type WebSearchFaviconProps = {
  host: string;
  label?: string;
  size?: number;
  className?: string;
  rounded?: "full" | "md" | "lg";
};

const PALETTE = [
  "bg-emerald-500 text-white",
  "bg-sky-500 text-white",
  "bg-violet-500 text-white",
  "bg-amber-500 text-white",
  "bg-rose-500 text-white",
  "bg-teal-500 text-white",
  "bg-indigo-500 text-white",
  "bg-orange-500 text-white",
];

const MIN_BYTES = 64;

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h % PALETTE.length;
}

/** @deprecated use resolveFaviconCandidates — kept for existing imports/tests */
export function faviconCandidatesForHost(host: string): string[] {
  return resolveFaviconCandidates(host, 64);
}

function looksLikeImageBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MIN_BYTES) return false;
  // UTF-8 replacement of a high leading byte (legacy curl corruption): EF BF BD …
  if (bytes[0] === 0xef && bytes[1] === 0xbf && bytes[2] === 0xbd) return false;
  // PNG / JPEG / GIF / ICO / RIFF(webp) / SVG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && (bytes[2] === 0x01 || bytes[2] === 0x02) && bytes[3] === 0x00) {
    return true;
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return true;
  }
  const head = new TextDecoder().decode(bytes.slice(0, 64)).trim().toLowerCase();
  if (head.startsWith("<svg") || head.includes("<svg")) return true;
  return false;
}

function mimeFromBytes(bytes: Uint8Array, fallback: string): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x00 && bytes[1] === 0x00) return "image/x-icon";
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
  const head = new TextDecoder().decode(bytes.slice(0, 64)).trim().toLowerCase();
  if (head.startsWith("<svg") || head.includes("<svg")) return "image/svg+xml";
  return fallback.startsWith("image/") ? fallback : "image/png";
}

/**
 * Near Desktop loads favicons as binary → data/blob URL in a privileged process.
 * Portal mirrors that for the same-origin BFF so we never paint a letter avatar
 * over a cached/corrupt `<img src>` response.
 */
async function fetchBffFaviconObjectUrl(host: string): Promise<string | null> {
  const variants = hostVariants(host);
  for (const variant of variants) {
    const url = `/api/web-search/favicon?host=${encodeURIComponent(variant)}&v=2`;
    try {
      const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!looksLikeImageBytes(bytes)) continue;
      const mime = mimeFromBytes(
        bytes,
        res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png",
      );
      const blob = new Blob([bytes], { type: mime });
      return URL.createObjectURL(blob);
    } catch {
      // try next host variant
    }
  }
  return null;
}

function isUsableFaviconImage(img: HTMLImageElement): boolean {
  if (img.naturalWidth < 8 || img.naturalHeight < 8) return false;
  return true;
}

/**
 * Site favicon with letter-avatar fallback.
 *
 * Loading → muted placeholder (never flash colorful letters).
 * Success → favicon only (letter unmounted — no stacking over translucent PNGs).
 * Failure → letter avatar only.
 */
export function WebSearchFavicon({
  host,
  label,
  size = 18,
  className = "",
  rounded = "md",
}: WebSearchFaviconProps) {
  const cdnCandidates = React.useMemo(() => {
    return resolveFaviconCandidates(host, 64).filter((u) => !u.startsWith("/api/"));
  }, [host]);
  const [blobSrc, setBlobSrc] = React.useState<string | null>(null);
  const [cdnIdx, setCdnIdx] = React.useState(0);
  const [imgReady, setImgReady] = React.useState(false);
  const [bffDone, setBffDone] = React.useState(false);
  const letter = (label || host || "?").replace(/^www\./i, "").charAt(0).toUpperCase() || "?";
  const color = PALETTE[hashHue(host || letter)] ?? PALETTE[0];
  const radius =
    rounded === "full" ? "rounded-full" : rounded === "lg" ? "rounded-lg" : "rounded-md";
  const fontSize = Math.max(8, Math.min(Math.round(size * 0.55), size - 2));

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setBlobSrc(null);
    setCdnIdx(0);
    setImgReady(false);
    setBffDone(false);

    void (async () => {
      const url = await fetchBffFaviconObjectUrl(host);
      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setBlobSrc(url);
      setBffDone(true);
      // Do NOT set imgReady here — wait for <img onLoad> so we never stack
      // a half-decoded icon over the letter/placeholder.
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [host]);

  const cdnSrc = bffDone && !blobSrc ? cdnCandidates[cdnIdx] : undefined;
  const src = blobSrc ?? cdnSrc;
  const cdnExhausted = bffDone && !blobSrc && cdnIdx >= cdnCandidates.length;
  const showIcon = Boolean(src && imgReady);
  const showLetter = cdnExhausted && !showIcon;
  const showPlaceholder = !showIcon && !showLetter;

  const advanceCdn = React.useCallback(() => {
    setImgReady(false);
    setCdnIdx((v) => v + 1);
  }, []);

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${radius} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {showPlaceholder ? (
        <span className={`absolute inset-0 ${radius} bg-muted`} />
      ) : null}
      {showLetter ? (
        <span
          className={`absolute inset-0 flex items-center justify-center font-semibold leading-none ${color}`}
          style={{ fontSize }}
        >
          {letter}
        </span>
      ) : null}
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          width={size}
          height={size}
          draggable={false}
          decoding="async"
          referrerPolicy="no-referrer"
          className={`relative z-[1] object-cover ${radius}`}
          style={{
            width: size,
            height: size,
            opacity: imgReady ? 1 : 0,
            // Keep layout stable while decoding; hide until ready so nothing stacks.
            position: imgReady ? "relative" : "absolute",
            inset: imgReady ? undefined : 0,
          }}
          onLoad={(event) => {
            const img = event.currentTarget;
            if (!isUsableFaviconImage(img)) {
              if (blobSrc) {
                URL.revokeObjectURL(blobSrc);
                setBlobSrc(null);
                setImgReady(false);
                return;
              }
              advanceCdn();
              return;
            }
            setImgReady(true);
          }}
          onError={() => {
            if (blobSrc) {
              URL.revokeObjectURL(blobSrc);
              setBlobSrc(null);
              setImgReady(false);
              return;
            }
            advanceCdn();
          }}
        />
      ) : null}
    </span>
  );
}
