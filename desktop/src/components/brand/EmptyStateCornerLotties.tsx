import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LottieSvg } from "lottie-react";
import thinkingQuestions from "../../assets/empty-state/thinking-questions.json";
import workingLaptop from "../../assets/empty-state/working-laptop.json";
import { useAppStore } from "../../store";
import { accentBottomRgb, accentPrimaryRgb, recolorEmptyLottieClothes } from "./recolor-empty-lottie";

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduce;
}

function useEmptyFigureSources() {
  const reduce = usePrefersReducedMotion();
  const themeColor = useAppStore((s) => s.themeColor);
  const theme = useAppStore((s) => s.theme);
  const primary = accentPrimaryRgb(themeColor, theme);
  const bottom = accentBottomRgb(themeColor);
  const workingSrc = useMemo(
    () => recolorEmptyLottieClothes(workingLaptop, "work", primary, bottom),
    [primary, bottom],
  );
  const thinkingSrc = useMemo(
    () => recolorEmptyLottieClothes(thinkingQuestions, "think", primary, bottom),
    [primary, bottom],
  );
  return { reduce, themeColor, thinkingSrc, workingSrc };
}

/** Header pair: man (question marks) on the left, woman (laptop) on the right. */
export function EmptyStateHeaderFigures({ className = "" }: { className?: string }) {
  const { reduce, themeColor, thinkingSrc, workingSrc } = useEmptyFigureSources();
  const manWidth = 96;
  const womanWidth = 56;
  return (
    <div
      data-testid="empty-header-figures"
      data-accent={themeColor}
      aria-hidden
      className={`pointer-events-none flex shrink-0 items-end gap-1.5 ${className}`}
    >
      <span data-testid="empty-header-figure" data-kind="man">
        <LottieSvg
          src={thinkingSrc}
          autoplay={!reduce}
          loop={!reduce}
          className="block"
          style={{ width: manWidth, height: manWidth * (876 / 824) }}
        />
      </span>
      <span data-testid="empty-header-figure" data-kind="woman">
        <LottieSvg
          src={workingSrc}
          autoplay={!reduce}
          loop={!reduce}
          className="block"
          style={{ width: womanWidth, height: womanWidth * (918 / 496) }}
        />
      </span>
    </div>
  );
}

export function EmptyStateCornerLotties({
  children,
  stageSize = 200,
}: {
  children?: ReactNode;
  stageSize?: number;
}) {
  const { reduce, themeColor, thinkingSrc, workingSrc } = useEmptyFigureSources();
  return (
    <div
      data-testid="empty-lottie-row"
      data-accent={themeColor}
      className="relative mx-auto [@media(max-height:560px)]:[&_[data-testid=empty-lottie-slot]]:hidden"
      style={{ width: stageSize }}
    >
      <div className="pointer-events-auto relative z-10 w-full">{children}</div>
      <div
        data-testid="empty-lottie-horizon"
        className="pointer-events-none absolute inset-0 z-20"
      >
        <div
          data-testid="empty-lottie-slot"
          data-side="left"
          className="absolute bottom-0 left-[-84px] w-[96px]"
          aria-hidden
        >
          <LottieSvg
            src={thinkingSrc}
            autoplay={!reduce}
            loop={!reduce}
            className="block w-[96px] opacity-90"
            style={{ height: 96 * (876 / 824) }}
          />
        </div>
        <div
          data-testid="empty-lottie-slot"
          data-side="right"
          className="absolute bottom-0 left-[96%] z-20 w-[64px]"
          aria-hidden
        >
          <LottieSvg
            src={workingSrc}
            autoplay={!reduce}
            loop={!reduce}
            className="block w-[64px] opacity-90"
            style={{ height: 64 * (918 / 496) }}
          />
        </div>
      </div>
    </div>
  );
}
