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

type EffectLayer = { children?: ReactNode; opacity?: number };
export const SimplexNoise: ComponentType<EffectLayer & { colorA: string; colorB: string; scale: number; contrast: number; seed: number; speed: number }>;
export const Ripples: ComponentType<EffectLayer & { colorA: string; colorB: string; frequency: number; softness: number; thickness: number; speed: number }>;
export const Glass: ComponentType<EffectLayer & { refraction: number; scale: number; aberration: number; blur: number }>;
export const FlutedGlass: ComponentType<EffectLayer & { frequency: number; refraction: number; angle: number; speed: number; softness: number; aberration: number }>;
export const CursorRipples: ComponentType<EffectLayer & { intensity: number; radius: number; decay: number; chromaticSplit: number }>;

export const RadialGradient: ComponentType<EffectLayer & {
  colorA: string; colorB: string; center: { x: number; y: number }; radius: number;
}>;
