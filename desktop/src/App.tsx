import { useEffect, useState } from "react";
import { FloatingBall } from "./components/FloatingBall";
import { Sidebar } from "./components/Sidebar";

export function App() {
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState<"idle" | "listening" | "processing">("idle");
  const [sessionId, setSessionId] = useState<string>("");

  useEffect(() => {
    (async () => {
      const resp = await fetch("/api/session");
      const data = await resp.json();
      setSessionId(data.session_id);
    })();
  }, []);

  return (
    <div style={{ height: "100vh", background: "#0c111f", color: "#fff" }}>
      <FloatingBall status={status} onToggle={() => setOpen((v) => !v)} />
      {open && sessionId ? (
        <Sidebar
          sessionId={sessionId}
          onStatusChange={setStatus}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
