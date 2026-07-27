"use client";

import * as React from "react";

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

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h % PALETTE.length;
}

/**
 * Same-origin BFF first (server uses proxy-aware fetch), then public CDNs.
 * Never leave a blank circle: letter avatar is the base layer until an image loads.
 */
export function faviconCandidatesForHost(host: string): string[] {
  const h = host.trim().toLowerCase().replace(/^www\./, "");
  if (!h) return [];
  return [
    `/api/web-search/favicon?host=${encodeURIComponent(h)}`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(h)}.ico`,
    `https://favicon.yandex.net/favicon/${encodeURIComponent(h)}`,
  ];
}

export function WebSearchFavicon({
  host,
  label,
  size = 18,
  className = "",
  rounded = "md",
}: WebSearchFaviconProps) {
  const candidates = React.useMemo(() => faviconCandidatesForHost(host), [host]);
  const [idx, setIdx] = React.useState(0);
  const [imgReady, setImgReady] = React.useState(false);
  const letter = (label || host || "?").replace(/^www\./i, "").charAt(0).toUpperCase() || "?";
  const color = PALETTE[hashHue(host || letter)] ?? PALETTE[0];
  const radius =
    rounded === "full" ? "rounded-full" : rounded === "lg" ? "rounded-lg" : "rounded-md";
  const src = candidates[idx];

  React.useEffect(() => {
    setIdx(0);
    setImgReady(false);
  }, [host]);

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${radius} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span
        className={`absolute inset-0 flex items-center justify-center font-semibold ${color}`}
        style={{ fontSize: Math.max(10, Math.round(size * 0.48)) }}
      >
        {letter}
      </span>
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          width={size}
          height={size}
          className={`relative z-[1] object-cover ${radius}`}
          style={{
            width: size,
            height: size,
            opacity: imgReady ? 1 : 0,
          }}
          onLoad={() => setImgReady(true)}
          onError={() => {
            setImgReady(false);
            setIdx((v) => v + 1);
          }}
        />
      ) : null}
    </span>
  );
}
