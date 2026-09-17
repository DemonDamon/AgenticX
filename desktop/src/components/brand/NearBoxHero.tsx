import { useEffect, useRef, useState, type CSSProperties } from "react";
import { APP_TAGLINE } from "../../constants/branding";
import { getNearBoxCharacter, type NearBoxCharacter } from "./near-box-engine.js";
import {
  NEAR_BOX_IDLE_HOLD_MS,
  nextNearBoxIdleMood,
  resolveNearBoxMood,
  type NearBoxMood,
} from "./near-box-hero";
import "./near-box-hero.css";

const BODY = "#FF7A45";
const EYE = "#F9F9F9";

export function NearBoxHero({
  size = 160,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const botRef = useRef<NearBoxCharacter | null>(null);
  const [hovered, setHovered] = useState(false);
  const [idle, setIdle] = useState<NearBoxMood>("proud");
  const mood = resolveNearBoxMood({ hovered, idle });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const Character = getNearBoxCharacter();
    const bot = new Character(svg, {
      shape: "squircle",
      color: "orange",
      scheme: "light",
      loginWrap: true,
      followPointer: !reduce,
      inkFlat: BODY,
      eyeColor: EYE,
      mode: "hold",
      state: "proud",
      sizePx: size,
      reduceMotion: reduce,
    });
    bot.setInk(BODY);
    bot.setEyeColor(EYE);
    bot.setState("proud", { resetEyes: true });
    botRef.current = bot;
    return () => {
      bot.destroy();
      botRef.current = null;
      svg.innerHTML = "";
    };
  }, [size]);

  useEffect(() => {
    botRef.current?.setState(mood, { resetEyes: false });
  }, [mood]);

  useEffect(() => {
    if (hovered) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setIdle((current) => nextNearBoxIdleMood(current));
    }, NEAR_BOX_IDLE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [hovered, idle]);

  return (
    <div className={`near-box-stack ${className}`.trim()}>
      <div
        className="near-box-hero"
        data-testid="near-box-hero"
        data-mood={mood}
        style={{ "--near-box-size": `${size}px` } as CSSProperties}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <svg ref={svgRef} role="img" aria-label="Near" />
      </div>
      <p className="near-box-tagline" data-testid="near-box-tagline">
        {APP_TAGLINE}
      </p>
    </div>
  );
}
