import type { ComponentType, CSSProperties, ReactNode } from "react";
/** Public subset verified against shaders 4.0.4; no blanket skipLibCheck or any. */
export const Shader: ComponentType<{
  children?: ReactNode;
  disableTelemetry?: boolean;
  colorSpace?: "p3-linear" | "srgb";
  className?: string;
  style?: CSSProperties;
  onReady?: () => void;
  onUnavailable?: (reason: string) => void;
}>;
export const LinearGradient: ComponentType<{
  colorA: string; colorB: string; angle?: number; opacity?: number;
}>;
export function getWebGPUSupport(): Promise<{ supported: boolean }>;
