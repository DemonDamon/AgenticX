import type { MouseEventHandler } from "react";

type Props = {
  status: "idle" | "listening" | "processing";
  x: number;
  y: number;
  onToggle: () => void;
  onMove: (x: number, y: number) => void;
  onOpenSettings: () => void;
  onQuit: () => void;
  onVoicePressStart: () => void;
  onVoicePressEnd: () => void;
};

const colorMap = {
  idle: "bg-emerald-400",
  listening: "bg-cyan-400 animate-pulse",
  processing: "bg-amber-400 animate-spin"
};

export function FloatingBall({
  status,
  x,
  y,
  onToggle,
  onMove,
  onOpenSettings,
  onQuit,
  onVoicePressStart,
  onVoicePressEnd
}: Props) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  const onMouseDown: MouseEventHandler<HTMLButtonElement> = (event) => {
    dragging = true;
    offsetX = event.clientX - x;
    offsetY = event.clientY - y;
    onVoicePressStart();
    const onMoveHandler = (moveEvent: MouseEvent) => {
      if (!dragging) return;
      onMove(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
    };
    const onUpHandler = () => {
      dragging = false;
      onVoicePressEnd();
      window.removeEventListener("mousemove", onMoveHandler);
      window.removeEventListener("mouseup", onUpHandler);
    };
    window.addEventListener("mousemove", onMoveHandler);
    window.addEventListener("mouseup", onUpHandler);
  };

  return (
    <div className="fixed z-30" style={{ left: x, top: y }}>
      <button
        onClick={onToggle}
        onMouseDown={onMouseDown}
        onMouseUp={onVoicePressEnd}
        onContextMenu={(event) => {
          event.preventDefault();
          const choice = window.prompt("菜单: 1设置 2切换侧边栏 3退出", "1");
          if (choice === "1") onOpenSettings();
          if (choice === "2") onToggle();
          if (choice === "3") onQuit();
        }}
        className={`h-14 w-14 cursor-pointer rounded-full border-2 border-white/20 shadow-2xl ${colorMap[status]}`}
        title={`AgenticX (${status})`}
      />
    </div>
  );
}
