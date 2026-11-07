import { Bot } from "lucide-react";

import { canonicalizeHarnessId } from "../../utils/harness-display";
import { harnessMarkSrc } from "./harness-marks";

type Props = {
  harnessId: string | null | undefined;
  /** Pixel box for the glyph (badge ~16, picker ~14). */
  size?: number;
  className?: string;
  title?: string;
};

/**
 * Shared exclusive harness mark for bubble corner badge + picker.
 * Known brands (incl. Near app icon for AgenticX) render as <img>.
 */
export function HarnessMark({ harnessId, size = 16, className = "", title }: Props) {
  const id = canonicalizeHarnessId(harnessId);
  const src = harnessMarkSrc(id);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        title={title}
        data-harness-mark={id}
        width={size}
        height={size}
        className={`shrink-0 object-contain ${className}`}
        draggable={false}
        aria-hidden
      />
    );
  }
  return (
    <Bot
      size={size}
      strokeWidth={2.4}
      className={className}
      data-harness-mark={id || "python-agent"}
      aria-hidden
    />
  );
}
