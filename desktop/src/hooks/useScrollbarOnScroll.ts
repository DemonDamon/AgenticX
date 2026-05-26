import { useEffect, useRef } from "react";

const SCROLLBAR_IDLE_MS = 800;

/** 滚动时短暂显示滚动条，静止后自动隐藏（macOS 式 overlay 行为）。 */
export function useScrollbarOnScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      el.classList.add("is-scrolling");
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        el.classList.remove("is-scrolling");
      }, SCROLLBAR_IDLE_MS);
    };

    el.addEventListener("scroll", reveal, { passive: true });
    return () => {
      el.removeEventListener("scroll", reveal);
      if (idleTimer) clearTimeout(idleTimer);
      el.classList.remove("is-scrolling");
    };
  }, []);

  return ref;
}
