import { useEffect, useRef, useState } from "react";
import { Shader, LinearGradient, getWebGPUSupport } from "../../appearance/shader-runtime";
import type { Wallpaper } from "../../../shared/chat-appearance";
import { gradientColors } from "../../appearance/render";
import { useAppearanceStore } from "../../appearance/store";

export default function ShaderWallpaper({ wallpaper, speed, pulse = 0, duration, onComplete }: {
  wallpaper: Wallpaper; speed: number; pulse?: number; duration?: number; onComplete?: () => void;
}) {
  const [supported, setSupported] = useState(false);
  const [ready, setReady] = useState(false);
  const [angle, setAngle] = useState(0);
  const readyRef = useRef(false);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  useEffect(() => {
    let cancelled = false;
    const fail = () => { if (!cancelled) useAppearanceStore.getState().markGpuUnavailable(); };
    const timer = window.setTimeout(() => { if (!readyRef.current) fail(); }, 5000);
    void getWebGPUSupport().then(result => { if (cancelled) return; if (result.supported) setSupported(true); else fail(); }).catch(fail);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const start = performance.now(); let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const offset = duration ? 48 * Math.sin(Math.PI * Math.min(1, elapsed / duration)) ** 2 * speed : elapsed * 0.008 * speed;
      setAngle(offset);
      if (duration && elapsed >= duration) { completeRef.current?.(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, speed, pulse, duration]);
  if (!supported) return null;
  const c = gradientColors(wallpaper);
  return <Shader className="agx-wallpaper-shader" colorSpace="srgb" disableTelemetry style={{ opacity: ready ? 1 : 0, transition: "opacity 180ms" }}
    onReady={() => { readyRef.current = true; setReady(true); }}
    onUnavailable={() => useAppearanceStore.getState().markGpuUnavailable()}>
    <LinearGradient colorA={c[0]} colorB={c[1]} angle={wallpaper.angle + angle} />
    <LinearGradient colorA={c[2]} colorB={c[3]} angle={wallpaper.angle + 90 - angle} opacity={0.5} />
  </Shader>;
}
