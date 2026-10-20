import { useEffect, useRef, useState } from "react";
import { Shader, LinearGradient, RadialGradient, SimplexNoise, Ripples, Glass, FlutedGlass, CursorRipples, getWebGPUSupport } from "../../appearance/shader-runtime";
import type { Wallpaper } from "../../../shared/chat-appearance";
import { effectTone, gradientColors } from "../../appearance/render";
import { useAppearanceStore } from "../../appearance/store";

export default function ShaderWallpaper({ wallpaper, speed, pulse = 0, duration, onComplete }: {
  wallpaper: Wallpaper; speed: number; pulse?: number; duration?: number; onComplete?: () => void;
}) {
  const [supported, setSupported] = useState(false);
  const [ready, setReady] = useState(false);
  const [frameState, setFrameState] = useState({ angle: 0, envelope: 0 });
  const effect = wallpaper.type === "shader" ? wallpaper.effect : null;
  const id = effect?.id ?? "gradient";
  const needsAngle = id === "gradient" || id === "glass";
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
    if (!ready || (!duration && !needsAngle)) return;
    const start = performance.now(); let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const envelope = duration ? Math.sin(Math.PI * Math.min(1, elapsed / duration)) ** 2 : 1;
      const angle = needsAngle ? (duration ? 48 * envelope * speed : elapsed * 0.008 * speed) : 0;
      setFrameState({ angle, envelope });
      if (duration && elapsed >= duration) { completeRef.current?.(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, speed, pulse, duration, needsAngle]);
  if (!supported) return null;
  const c = gradientColors(wallpaper);
  const base = <>
    <LinearGradient colorA={c[0]} colorB={c[1]} angle={wallpaper.angle + frameState.angle} />
    <LinearGradient colorA={c[2]} colorB={c[3]} angle={wallpaper.angle + 90 - frameState.angle} opacity={0.5} />
  </>;
  // Refraction of a smooth linear fill is almost invisible. Give lenses and
  // pointer distortion a textured field with localized highlights to bend.
  const phase = frameState.angle * Math.PI / 180;
  const highlights = <>
    <RadialGradient colorA={effectTone(c[0], 255, .42)} colorB={effectTone(c[1], 0, .25)} center={{ x: .28 + Math.sin(phase) * .18, y: .32 + Math.sin(phase * .7) * .1 }} radius={.52} />
    <RadialGradient colorA={effectTone(c[2], 255, .28)} colorB={`${c[3]}00`} center={{ x: .76 - Math.sin(phase) * .14, y: .7 - Math.sin(phase * .7) * .12 }} radius={.36} opacity={.8} />
  </>;
  const detailed = <>{base}{highlights}
    <SimplexNoise colorA={effectTone(c[0], 255, .32)} colorB={effectTone(c[1], 0, .3)} scale={1.1} contrast={.8} seed={0} speed={.18 * speed} opacity={.35} />
  </>;
  let layers = effect?.id === "gradient" ? <>{base}{highlights}</> : base;
  switch (effect?.id) {
    case "noise": layers = <>{base}<SimplexNoise {...effect.params} colorA={effectTone(c[0], 255, .28)} colorB={effectTone(c[1], 0, .22)} speed={.35 * speed} opacity={1} /></>; break;
    case "ripples": layers = <>{base}<Ripples {...effect.params} colorA={effectTone(c[0], 255, .4)} colorB={effectTone(c[1], 0, .25)} speed={.3 * speed} opacity={1} /></>; break;
    case "glass": layers = <Glass {...effect.params} blur={0}>{detailed}</Glass>; break;
    case "fluted-glass": layers = <FlutedGlass {...effect.params} softness={.65} aberration={.05} speed={.12 * speed}>{detailed}</FlutedGlass>; break;
    case "cursor-ripples": layers = <CursorRipples {...effect.params} decay={Math.min(20, effect.params.decay * speed)} chromaticSplit={.1}>{detailed}</CursorRipples>; break;
  }
  const opacity = ready ? (effect?.opacity ?? 1) * (id !== "gradient" && duration ? frameState.envelope : 1) : 0;
  return <Shader className="agx-wallpaper-shader" colorSpace="srgb" disableTelemetry style={{ opacity, transition: "opacity 180ms" }}
    onReady={() => { readyRef.current = true; setReady(true); }}
    onUnavailable={() => useAppearanceStore.getState().markGpuUnavailable()}>
    {layers}
  </Shader>;
}
