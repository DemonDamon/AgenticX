import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { APP_TAGLINE } from "../../constants/branding";
import {
  EYE_PLAYLIST,
  applyLid,
  blinksForMood,
  gazeForMood,
  holdMs,
  hopMs,
  marksForShape,
  nextIdleMood,
  nextPlaylistIndex,
  wanderMs,
  type Gaze,
  type NearBoxMoodId,
  type SensorMark,
} from "./near-box-moods";
import "./near-box-hero.css";

function SensorMarkView({ mark }: { mark: SensorMark }) {
  return (
    <ellipse
      data-part="sensor"
      data-kind="oval"
      className="near-box-sensor"
      cx={mark.cx}
      cy={mark.cy}
      rx={mark.rx}
      ry={mark.ry}
      fill="#FFF9F6"
      transform={`rotate(${mark.rotate} ${mark.cx} ${mark.cy})`}
    />
  );
}

const BLINK_WAIT: Record<NearBoxMoodId, readonly [number, number]> = {
  rest: [6000, 14000],
  curious: [2500, 5500],
  smug: [3500, 7000],
  happy: [2500, 5000],
  laugh: [2500, 5000],
  listening: [3000, 7000],
  excited: [2000, 4000],
  surprised: [1800, 3500],
};

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const OUTER_SHELL =
  "M80 18C86 18 91 20 97 23L136 46C141 49 144 53 144 58V108C144 119 138 124 130 129L92 151C84 156 76 156 68 151L30 129C22 124 16 119 16 108V58C16 53 19 49 24 46L63 23C69 20 74 18 80 18Z";
const BURST_DURATION_MS = 2200;

const CONFETTI_COLORS = [
  "#FF6038",
  "#FFC533",
  "#159B65",
  "#F72585",
  "#20C7D6",
  "#7657FF",
] as const;
const CONFETTI_KINDS = ["tile", "dot", "star", "ribbon"] as const;
const CONFETTI = Array.from({ length: 58 }, (_, index) => {
  const baseAngle = -80 + (index / 57) * 160;
  const angle = baseAngle + ((((index * 17) % 11) - 5) * 0.7);
  const radians = (angle * Math.PI) / 180;
  const distance =
    index % 5 === 4 ? 108 + ((index * 29) % 42) : 178 + ((index * 53) % 56);
  return {
    x: Math.round(Math.sin(radians) * distance),
    y: -Math.round(Math.cos(radians) * distance),
    r: ((index * 67) % 360) - 180,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length] ?? "#FF7A45",
    kind: CONFETTI_KINDS[index % CONFETTI_KINDS.length] ?? "tile",
    delay: (index % 11) * 29,
  };
});

export function NearBoxHero({
  size = 160,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const clipId = `near-box-shell-${useId().replace(/:/g, "")}`;
  const sensorRef = useRef<SVGGElement>(null);
  const burstTimerRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [bursting, setBursting] = useState(false);
  const [burstKey, setBurstKey] = useState(0);
  const [gaze, setGaze] = useState<"wander" | "track">("wander");
  const [idleMood, setIdleMood] = useState<NearBoxMoodId>("rest");
  const [shapeIndex, setShapeIndex] = useState(0);
  const [look, setLook] = useState<Gaze>({ x: 0, y: 0 });
  const [lid, setLid] = useState(1);

  const mood: NearBoxMoodId = bursting ? "surprised" : hovered ? "listening" : idleMood;
  const playlist = EYE_PLAYLIST[mood];
  const eyeShape = playlist[shapeIndex] ?? playlist[0] ?? "restSoft";
  const [leftMark, rightMark] = marksForShape(eyeShape, look).map((mark) => applyLid(mark, lid)) as [
    SensorMark,
    SensorMark,
  ];

  useEffect(
    () => () => {
      if (burstTimerRef.current !== null) window.clearTimeout(burstTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    setShapeIndex(0);
    setLook(mood === "rest" ? { x: 0, y: 0 } : gazeForMood(mood, Math.random(), Math.random()));
    setLid(1);
  }, [mood]);

  useEffect(() => {
    if (hovered || bursting) return;
    if (prefersReducedMotion()) return;
    const timer = window.setTimeout(() => {
      setLook(gazeForMood(mood, Math.random(), Math.random()));
    }, wanderMs(mood, Math.random()));
    return () => window.clearTimeout(timer);
  }, [mood, look, hovered, bursting]);

  useEffect(() => {
    if (hovered || bursting) return;
    if (prefersReducedMotion()) return;
    const wait = holdMs(idleMood, Math.random());
    const timer = window.setTimeout(() => {
      setIdleMood((current) => nextIdleMood(current, Math.random(), Math.random()));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [hovered, bursting, idleMood]);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (playlist.length <= 1) return;
    const timer = window.setTimeout(() => {
      setShapeIndex((current) => nextPlaylistIndex(mood, current));
      setLook(gazeForMood(mood, Math.random(), Math.random()));
    }, hopMs(mood, Math.random()));
    return () => window.clearTimeout(timer);
  }, [mood, shapeIndex, playlist.length]);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let cancelled = false;
    const timers: number[] = [];
    const schedule = () => {
      const [lo, hi] = BLINK_WAIT[mood];
      const wait = Math.round(lo + Math.random() * (hi - lo));
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          const double = Math.random() < 0.14;
          setLid(0.05);
          timers.push(window.setTimeout(() => {
            if (!cancelled) setLid(1.08);
          }, 150));
          timers.push(window.setTimeout(() => {
            if (!cancelled) setLid(1);
          }, 300));
          if (double) {
            timers.push(window.setTimeout(() => {
              if (!cancelled) setLid(0.05);
            }, 370));
            timers.push(window.setTimeout(() => {
              if (!cancelled) setLid(1);
            }, 480));
          }
          timers.push(window.setTimeout(() => {
            if (!cancelled) schedule();
          }, double ? 520 : 340));
        }, wait),
      );
    };
    schedule();
    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [mood]);

  const setParallax = (x: number, y: number) => {
    if (sensorRef.current) {
      sensorRef.current.style.transform = `translate(${x * 3}px, ${y * 3}px)`;
    }
  };

  const clearParallax = () => {
    if (sensorRef.current) sensorRef.current.style.transform = "";
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (bursting) return;
    setGaze("track");
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.width ? ((event.clientX - rect.left) / rect.width) * 2 - 1 : 0;
    const y = rect.height ? ((event.clientY - rect.top) / rect.height) * 2 - 1 : 0;
    setParallax(
      Math.round(Math.max(-1, Math.min(1, x))),
      Math.round(Math.max(-1, Math.min(1, y))),
    );
  };

  const launchConfetti = () => {
    setParallax(0, 0);
    if (sensorRef.current) sensorRef.current.style.transform = "translate(0px, 17px)";
    setBursting(true);
    setBurstKey((value) => value + 1);
    if (burstTimerRef.current !== null) window.clearTimeout(burstTimerRef.current);
    burstTimerRef.current = window.setTimeout(() => {
      setBursting(false);
      setGaze("wander");
      clearParallax();
      burstTimerRef.current = null;
    }, BURST_DURATION_MS);
  };

  return (
    <div className={`near-box-stack ${className}`.trim()}>
      <button
        type="button"
        className="near-box-hero"
        data-testid="near-box-hero"
        data-state={hovered ? "active" : "idle"}
        data-gaze={gaze}
        data-mood={mood}
        data-eye-shape={eyeShape}
        data-lid={lid === 1 ? "1" : String(lid)}
        data-blink={blinksForMood(mood) ? "on" : "off"}
        data-bursting={bursting}
        style={{ "--near-box-size": `${size}px` } as CSSProperties}
        aria-label="打开 Near 礼盒"
        onPointerEnter={() => {
          setHovered(true);
          setGaze("track");
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          setHovered(false);
          setGaze("wander");
          setIdleMood("rest");
          if (!bursting) clearParallax();
        }}
        onClick={launchConfetti}
      >
        {bursting ? (
          <span key={burstKey} className="near-box-burst" aria-hidden>
            {CONFETTI.map((piece, index) => (
              <span
                key={index}
                data-part="confetti"
                className={`near-box-confetti near-box-confetti-${piece.kind}`}
                style={
                  {
                    "--confetti-x": `${piece.x}px`,
                    "--confetti-y": `${piece.y}px`,
                    "--confetti-r": `${piece.r}deg`,
                    "--confetti-color": piece.color,
                    "--confetti-delay": `${piece.delay}ms`,
                  } as CSSProperties
                }
              />
            ))}
          </span>
        ) : null}
        <svg
          viewBox="0 0 160 160"
          role="img"
          aria-label="Near signal"
          data-character="near-box-original"
          shapeRendering="geometricPrecision"
        >
          <defs>
            <clipPath id={clipId} data-part="shell-clip">
              <path d={OUTER_SHELL} />
            </clipPath>
            <clipPath id={`${clipId}-sensors`} data-part="sensor-clip">
              <path d={OUTER_SHELL} />
            </clipPath>
          </defs>
          <g className="near-box-character">
            <g className="near-box-cube">
              <path data-part="outer-shell" d={OUTER_SHELL} fill="#FF7A45" />
              <g clipPath={`url(#${clipId})`}>
                <path
                  data-part="left-face"
                  d="M16 58L80 96V166H0V58Z"
                  fill="#FF7A45"
                />
                <path
                  data-part="right-face"
                  d="M80 96L144 58V166H80Z"
                  fill="#F4662E"
                />
                <path
                  data-part="top-face"
                  className="near-box-top"
                  d="M80 18C86 18 91 20 97 23L136 46C141 49 144 53 144 58L80 96L16 58C16 53 19 49 24 46L63 23C69 20 74 18 80 18Z"
                  fill="#FF965F"
                />
              </g>
            </g>
            {bursting ? (
              <g className="near-box-flaps" aria-hidden>
                <path
                  data-part="box-flap"
                  className="near-box-flap near-box-flap-back-left"
                  d="M80 18L16 58L-2 33L62 -5Z"
                  fill="#FFAA78"
                />
                <path
                  data-part="box-flap"
                  className="near-box-flap near-box-flap-back-right"
                  d="M80 18L144 58L162 33L98 -5Z"
                  fill="#FF9864"
                />
                <path
                  data-part="box-cavity"
                  className="near-box-cavity"
                  d="M16 58L80 18L144 58L80 96Z"
                  fill="#B94319"
                />
                <path
                  data-part="box-flap"
                  className="near-box-flap near-box-flap-front-left"
                  d="M16 58L80 96L66 116L-3 76Z"
                  fill="#FF8D59"
                />
                <path
                  data-part="box-flap"
                  className="near-box-flap near-box-flap-front-right"
                  d="M144 58L80 96L94 116L163 76Z"
                  fill="#F77640"
                />
              </g>
            ) : null}
            <g
              ref={sensorRef}
              data-part="sensor-group"
              className="near-box-sensors"
              clipPath={`url(#${clipId}-sensors)`}
            >
              <SensorMarkView mark={leftMark} />
              <SensorMarkView mark={rightMark} />
            </g>
          </g>
        </svg>
      </button>
      <p className="near-box-tagline" data-testid="near-box-tagline">
        {APP_TAGLINE}
      </p>
    </div>
  );
}
