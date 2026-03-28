import { useRef } from "react";

type Props = {
  onDrag: (delta: number) => void;
  direction?: "horizontal" | "vertical";
};

export function PaneDivider({ onDrag, direction = "horizontal" }: Props) {
  const draggingRef = useRef(false);
  const lastPosRef = useRef(0);

  const isVertical = direction === "vertical";

  return (
    <div
      className={`group relative flex shrink-0 bg-transparent touch-none ${
        isVertical
          ? "h-2 w-full cursor-row-resize items-center"
          : "w-2 h-full cursor-col-resize justify-center"
      }`}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        draggingRef.current = true;
        lastPosRef.current = isVertical ? event.clientY : event.clientX;
        const onMove = (moveEvent: MouseEvent) => {
          if (!draggingRef.current) return;
          const pos = isVertical ? moveEvent.clientY : moveEvent.clientX;
          const delta = pos - lastPosRef.current;
          lastPosRef.current = pos;
          onDrag(delta);
        };
        const onUp = () => {
          draggingRef.current = false;
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
      title={isVertical ? "拖拽调整窗格高度" : "拖拽调整窗格宽度"}
    >
      {isVertical ? (
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[rgba(255,255,255,0.06)] transition group-hover:bg-[rgba(255,255,255,0.18)]" />
      ) : (
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[rgba(255,255,255,0.06)] transition group-hover:bg-[rgba(255,255,255,0.18)]" />
      )}
    </div>
  );
}
