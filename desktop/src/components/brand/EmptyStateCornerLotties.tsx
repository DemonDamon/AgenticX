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

export function EmptyStateCornerLotties({
  children,
  stageSize = 200,
}: {
  children?: ReactNode;
  stageSize?: number;
}) {
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
