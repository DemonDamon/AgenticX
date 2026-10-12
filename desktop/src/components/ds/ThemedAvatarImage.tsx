/**
 * Leftover line-art portraits inherit --theme-color-rgb.
 * Near cubes, custom uploads, and the bundled Near mark stay as <img>.
 * Author: Damon Li
 */
import { useMemo } from "react";
import { isBundledMetaAvatarUrl } from "../../constants/meta-avatar";
import { prepareThemedPortraitMarkup } from "../../utils/theme-portrait";

type Props = {
  src: string;
  alt?: string;
  className?: string;
};

export function ThemedAvatarImage({ src, alt = "", className }: Props) {
  const markup = useMemo(
    () => (isBundledMetaAvatarUrl(src) ? null : prepareThemedPortraitMarkup(src)),
    [src],
  );
  if (!markup) {
    return <img src={src} alt={alt} className={className} />;
  }
  return (
    <span
      className={`agx-themed-portrait ${className ?? ""}`}
      style={{ color: "rgb(var(--theme-color-rgb, 59, 130, 246))" }}
      role="img"
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
