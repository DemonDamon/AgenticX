/**
 * Site favicon with Globe fallback (WorkPanel「参考信息」web rows).
 *
 * Author: Damon Li
 */

import { useEffect, useMemo, useState } from "react";
import { Globe } from "lucide-react";
import { resolveFaviconCandidates } from "../../utils/favicon-url";

type Props = {
  url?: string;
  domain?: string;
  className?: string;
  size?: number;
};

export function SiteFavicon({
  url,
  domain,
  className = "h-3.5 w-3.5",
  size = 32,
}: Props) {
  const candidates = useMemo(
    () => resolveFaviconCandidates(url, domain, size),
    [url, domain, size],
  );
  const [index, setIndex] = useState(0);
  const [failedAll, setFailedAll] = useState(false);

  useEffect(() => {
    setIndex(0);
    setFailedAll(false);
  }, [url, domain, size]);

  if (failedAll || candidates.length === 0) {
    return <Globe className={className} strokeWidth={1.7} aria-hidden />;
  }

  const src = candidates[index];
  if (!src) {
    return <Globe className={className} strokeWidth={1.7} aria-hidden />;
  }

  return (
    <img
      src={src}
      alt=""
      className={`${className} rounded-sm object-contain`}
      draggable={false}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        if (index + 1 < candidates.length) {
          setIndex((i) => i + 1);
        } else {
          setFailedAll(true);
        }
      }}
    />
  );
}
