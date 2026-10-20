import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { AppearanceMode, ChatAppearance, ImageAsset } from "../../../shared/chat-appearance";
import { PATTERN_STYLES, wallpaperBackground } from "../../appearance/render";
import { mayAnimate } from "../../appearance/animation-policy";
import { useAppearanceStore } from "../../appearance/store";
import "./chat-appearance.css";
const ShaderWallpaper = lazy(() => import("./ShaderWallpaper"));
class ShaderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { useAppearanceStore.getState().markGpuUnavailable(); }
  render() { return this.state.failed ? null : this.props.children; }
}
const assets = new Map<string, Promise<string>>();
// Bound retained base64 data; active components keep their own current image.
function rememberAsset(id: string, pending: Promise<string>): void {
  assets.delete(id);
  assets.set(id, pending);
  while (assets.size > 4) assets.delete(assets.keys().next().value!);
}
export function cacheWallpaper(asset: ImageAsset): void {
  rememberAsset(asset.id, Promise.resolve(`data:${asset.mime};base64,${asset.base64}`));
}
function readAsset(id: string): Promise<string> {
  let pending = assets.get(id);
  if (!pending) {
    pending = window.agenticxDesktop.readChatWallpaper(id).then(result => {
      if (!result.ok) throw new Error(result.error);
      return `data:${result.value.mime};base64,${result.value.base64}`;
    }).catch(error => { if (assets.get(id) === pending) assets.delete(id); throw error; });
    rememberAsset(id, pending);
  }
  return pending;
}
function useEnvironment(enabled: boolean) {
  const [environment, setEnvironment] = useState({ visible: true, focused: true, reduced: false });
  useEffect(() => {
    if (!enabled) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnvironment({ visible: !document.hidden, focused: document.hasFocus(), reduced: media.matches });
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update); window.addEventListener("blur", update); media.addEventListener("change", update);
    return () => { document.removeEventListener("visibilitychange", update); window.removeEventListener("focus", update); window.removeEventListener("blur", update); media.removeEventListener("change", update); };
  }, [enabled]);
  return environment;
}
export function ChatWallpaper({ appearance, mode, focused = false, preview = false, pulse = 0, animate = true }: {
  appearance: ChatAppearance; mode: AppearanceMode; focused?: boolean; preview?: boolean; pulse?: number; animate?: boolean;
}) {
  const variant = appearance.variants[mode];
  const w = variant.wallpaper;
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  const previewActive = useAppearanceStore(s => s.previewActive);
  const unavailable = useAppearanceStore(s => s.gpuUnavailable);
  const environment = useEnvironment(animate && appearance.motion !== "off" && (w.type === "gradient" || w.type === "shader"));
  const [burst, setBurst] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const effectVisible = w.type !== "shader" || (w.effect?.opacity ?? 1) > 0;
  const cursorEffect = w.type === "shader" && w.effect?.id === "cursor-ripples";
  useEffect(() => {
    if (!cursorEffect || !animate || appearance.motion === "off") return;
    const host = hostRef.current?.closest<HTMLElement>(".agx-appearance-host, .agx-appearance-preview");
    if (!host) return;
    const enter = () => setPointerInside(true);
    const leave = () => { setPointerInside(false); setBurst(false); };
    // The library listens on window. Mount only inside this host; never intercept chat input.
    setPointerInside(host.matches(":hover"));
    host.addEventListener("mouseenter", enter); host.addEventListener("mouseleave", leave);
    return () => { host.removeEventListener("mouseenter", enter); host.removeEventListener("mouseleave", leave); };
  }, [cursorEffect, animate, appearance.motion]);
  const lastPulse = useRef(pulse);
  useEffect(() => {
    if (w.type !== "image" || !w.assetId) return;
    let cancelled = false;
    void readAsset(w.assetId).then(url => { if (!cancelled) setImage({ id: w.assetId!, url }); }).catch(() => { if (!cancelled) setImage(null); });
    return () => { cancelled = true; };
  }, [w.type, w.assetId]);
  useEffect(() => {
    if (lastPulse.current === pulse) return;
    lastPulse.current = pulse;
    if (pulse && appearance.motion === "on-send" && focused && environment.focused && environment.visible && !environment.reduced && effectVisible && (!cursorEffect || pointerInside)) setBurst(true);
  }, [pulse, appearance.motion, focused, environment.focused, environment.visible, environment.reduced, cursorEffect, pointerInside, effectVisible]);
  const eligible = animate && mayAnimate({ motion: appearance.motion, type: w.type, focused: focused && environment.focused,
    visible: environment.visible, reducedMotion: environment.reduced, unavailable, preview, previewActive });
  const running = eligible && (!cursorEffect || pointerInside) && effectVisible && (appearance.motion === "continuous" || burst);
  useEffect(() => { if (!eligible || !effectVisible) setBurst(false); }, [eligible, effectVisible]);
  if (w.type === "default" && variant.pattern.id === "none" && variant.overlay === 0) return null;
  return <div ref={hostRef} className="agx-wallpaper" aria-hidden="true" data-wallpaper-type={w.type}>
    <div className="agx-wallpaper-layer" style={{ background: wallpaperBackground(w) }} />
    {w.type === "image" && image?.id === w.assetId ? <img className="agx-wallpaper-image" src={image.url} alt="" style={{ objectPosition: `${w.x * 100}% ${w.y * 100}%`, transform: `scale(${w.zoom})`, filter: `blur(${w.blur}px)` }} /> : null}
    {running ? <ShaderBoundary><Suspense fallback={null}><ShaderWallpaper key={w.effect?.id ?? "gradient"} wallpaper={w} speed={appearance.speed} pulse={pulse} duration={appearance.motion === "on-send" ? 900 : undefined} onComplete={() => setBurst(false)} /></Suspense></ShaderBoundary> : null}
    <div className="agx-wallpaper-layer" style={{ ...PATTERN_STYLES[variant.pattern.id], opacity: variant.pattern.opacity, color: mode === "light" ? "#172033" : "#FFFFFF" }} />
    <div className="agx-wallpaper-layer" style={{ background: mode === "light" ? "#FFFFFF" : "#000000", opacity: variant.overlay }} />
  </div>;
}
