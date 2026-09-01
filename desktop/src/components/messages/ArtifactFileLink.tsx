import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

type Props = {
  /** Absolute local filesystem path parsed from a sandbox:/file: link. */
  path: string;
  children: ReactNode;
  /** In-app preview; when omitted, falls back to the system handler. */
  onRevealPath?: (path: string) => void;
};

/**
 * Chat link for local artifact paths (sandbox:/file:). Prefers in-app preview
 * via onRevealPath; falls back to the system handler. Missing files (likely
 * model-hallucinated links) are flagged inline.
 */
export function ArtifactFileLink({ path, children, onRevealPath }: Props) {
  const [state, setState] = useState<"idle" | "opening" | "failed">("idle");
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current != null) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (state === "opening") return;
    setState("opening");
    void (async () => {
      try {
        const resolve = window.agenticxDesktop?.resolveLocalPath;
        if (typeof resolve === "function") {
          const info = await resolve(path);
          if (!info.ok || info.isDirectory) {
            setState("failed");
            return;
          }
        }
        if (typeof onRevealPath === "function") {
          onRevealPath(path);
          setState("idle");
          return;
        }
        const api = window.agenticxDesktop?.shellOpenPath;
        if (typeof api !== "function") {
          setState("failed");
          return;
        }
        const result = await api(path);
        setState(result?.ok ? "idle" : "failed");
      } catch {
        setState("failed");
      } finally {
        if (resetTimerRef.current != null) window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = window.setTimeout(() => setState("idle"), 4000);
      }
    })();
  };

  return (
    <a
      href={path}
      onClick={handleClick}
      title={
        state === "failed"
          ? `产物链接无效：文件不存在（疑似模型生成的伪链接）\n${path}`
          : path
      }
    >
      {children}
      {state === "opening" ? <span className="text-text-faint">（打开中…）</span> : null}
      {state === "failed" ? (
        <span className="text-amber-300" role="alert">
          {" "}
          ⚠ 文件不存在（疑似伪链接）
        </span>
      ) : null}
    </a>
  );
}
