import type { MouseEvent as ReactMouseEvent } from "react";

const MIN_WIDTH = 200;
const MAX_WIDTH = 420;

export function SidebarResizer() {
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const app = document.querySelector(".agx-app");
    app?.classList.add("is-resizing");
    const onMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.min(Math.max(moveEvent.clientX, MIN_WIDTH), MAX_WIDTH);
      document.documentElement.style.setProperty("--sidebar-width", `${nextWidth}px`);
    };
    const onUp = () => {
      app?.classList.remove("is-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try {
        const val = getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width").trim();
        if (val) window.localStorage.setItem("agx-sidebar-width", val);
      } catch {
        // ignore storage failures
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return <div className="agx-sidebar-resizer" onMouseDown={onMouseDown} />;
}
