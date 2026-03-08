import { useMemo, useState } from "react";
import { FloatingBall } from "./components/FloatingBall";
import { Sidebar } from "./components/Sidebar";

export function App() {
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState<"idle" | "listening" | "processing">("idle");
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  return (
    <div style={{ height: "100vh", background: "#0c111f", color: "#fff" }}>
      <FloatingBall status={status} onToggle={() => setOpen((v) => !v)} />
      {open ? (
        <Sidebar
          sessionId={sessionId}
          onStatusChange={setStatus}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
