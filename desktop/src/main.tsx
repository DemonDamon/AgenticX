import React, { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "katex/dist/katex.min.css";
import "./index.css";

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RootErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            padding: "2rem",
            fontFamily: "SF Pro Text, PingFang SC, sans-serif",
            color: "rgba(255,255,255,0.8)",
            background: "rgba(20,20,28,0.95)",
            WebkitAppRegion: "drag" as unknown as string,
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>
            应用渲染异常
          </h2>
          <pre
            style={{
              marginTop: "1rem",
              padding: "1rem",
              borderRadius: 8,
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,100,100,0.9)",
              fontSize: "0.8rem",
              maxWidth: "90%",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              WebkitAppRegion: "no-drag" as unknown as string,
            }}
          >
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1.5rem",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.85)",
              cursor: "pointer",
              fontSize: "0.85rem",
              WebkitAppRegion: "no-drag" as unknown as string,
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
