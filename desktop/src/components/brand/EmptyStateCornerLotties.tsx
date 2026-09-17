import { useEffect, useMemo, useState } from "react";
import { LottieSvg } from "lottie-react";
import thinkingQuestions from "../../assets/empty-state/thinking-questions.json";
import workingLaptop from "../../assets/empty-state/working-laptop.json";
import { recolorEmptyLottieClothes } from "./recolor-empty-lottie";

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

export function EmptyStateCornerLotties() {
  const reduce = usePrefersReducedMotion();
  const workingSrc = useMemo(() => recolorEmptyLottieClothes(workingLaptop, "work"), []);
  const thinkingSrc = useMemo(() => recolorEmptyLottieClothes(thinkingQuestions, "think"), []);
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[2] overflow-hidden [@media(max-height:560px)]:hidden"
      aria-hidden
    >
      <div
        data-testid="empty-lottie-slot"
        data-side="left"
        className="absolute bottom-2 left-6 hidden h-[200px] w-[132px] overflow-hidden min-[720px]:block"
      >
        <LottieSvg
          src={workingSrc}
          autoplay={!reduce}
          loop={!reduce}
          className="absolute bottom-0 left-0 w-[132px] opacity-90"
          style={{ height: 132 * (918 / 496) }}
        />
      </div>
      <div
        data-testid="empty-lottie-slot"
        data-side="right"
        className="absolute bottom-2 right-6 hidden h-[188px] w-[168px] overflow-hidden min-[720px]:block"
      >
        <LottieSvg
          src={thinkingSrc}
          autoplay={!reduce}
          loop={!reduce}
          className="absolute bottom-0 right-0 w-[168px] opacity-90"
          style={{ height: 168 * (876 / 824) }}
        />
      </div>
    </div>
  );
}
