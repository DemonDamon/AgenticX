import { useRef } from "react";

type Props = {
  onDrag: (deltaX: number) => void;
};

export function PaneDivider({ onDrag }: Props) {
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);

  return (
    <div
      className="group relative w-1.5 shrink-0 cursor-col-resize bg-transparent"
      onMouseDown={(event) => {
        draggingRef.current = true;
        lastXRef.current = event.clientX;
        const onMove = (moveEvent: MouseEvent) => {
          if (!draggingRef.current) return;
          const delta = moveEvent.clientX - lastXRef.current;
          lastXRef.current = moveEvent.clientX;
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
      title="拖拽调整窗格宽度"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/50 transition group-hover:bg-cyan-500/70" />
    </div>
  );
}
