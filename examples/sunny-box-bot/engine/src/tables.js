/* L4 — playlists, blink, login wrap, springs. Symbols: g1e VBe w_t cSe rnt int ant ont snt. */
(function (g) {
  const GROUPS = [
    { label: "Lifecycle", states: ["sleeping", "waking", "idle", "listening", "thinking", "searching", "working"] },
    { label: "Reactions", states: ["excited", "surprised", "suspicious", "angry", "drowsy", "happy", "curious", "confused", "bored", "proud", "shy", "sad", "laughing", "scared", "playful", "celebrate"] },
    { label: "Agent morphs", states: ["orbit", "radar", "progress"] },
    { label: "Product lifecycle", states: ["spawning", "humming", "loading", "dictating", "writing", "sending", "receiving", "uploading", "notifying", "alerting", "dragging", "bouncing", "powering-down"] },
  ];

  const EYE_PLAYLIST = {
    sleeping: [13, 22, 4], waking: [13], idle: [0, 8], listening: [10, 1, 19],
    thinking: [8, 16, 14, 17, 5], searching: [15, 9, 3, 20, 12, 18],
    working: [7, 16, 11, 10], excited: [2, 17, 21, 3, 11], surprised: [3, 21],
    suspicious: [14, 5, 23], angry: [7, 16], drowsy: [4, 22, 13],
    happy: [2, 11, 17, 19], curious: [3, 21, 0, 15], confused: [14, 5, 8],
    bored: [4, 22, 0], proud: [15, 8, 2], shy: [0, 24, 13], sad: [4, 13, 22],
    laughing: [2, 11, 17], scared: [3, 21], playful: [2, 17, 11, 8],
    celebrate: [2, 8, 17], orbit: [0, 8], radar: [0, 8], progress: [0, 8],
    spawning: [3, 0], humming: [0, 8], loading: [0, 8], dictating: [10, 1, 19],
    sending: [0, 8], receiving: [19, 0, 8], uploading: [15, 9, 8], writing: [15, 9],
    notifying: [3, 21, 0], alerting: [3, 21], bouncing: [2, 17],
    dragging: [3, 15, 0], "powering-down": [13, 22],
  };

  const EYE_HOLD_MS = {
    sleeping: [6000, 10000], waking: [800, 800], idle: [9000, 16000],
    listening: [2800, 5000], thinking: [2000, 3600], searching: [1000, 1800],
    working: [1800, 3200], excited: [1100, 2000], surprised: [2500, 4000],
    suspicious: [2600, 4500], angry: [2200, 3800], drowsy: [4000, 8000],
    happy: [2500, 4500], curious: [1800, 3200], confused: [2200, 3800],
    bored: [3500, 6000], proud: [3500, 6000], shy: [3000, 5500],
    sad: [4000, 7000], laughing: [1200, 2400], scared: [900, 1800],
    playful: [1500, 3000], celebrate: [1400, 2600], orbit: [4000, 8000],
    radar: [4000, 8000], progress: [4000, 8000], spawning: [1200, 1200],
    humming: [5000, 9000], loading: [6000, 10000], dictating: [4000, 8000],
    sending: [4000, 8000], receiving: [4000, 8000], uploading: [4000, 8000],
    writing: [4000, 8000], notifying: [1500, 2600], alerting: [2000, 3600],
    bouncing: [3000, 6000], dragging: [1600, 3000], "powering-down": [6000, 9000],
  };

  const BLINK_MS = {
    sleeping: null, waking: null, idle: [6000, 14000], listening: [3000, 7000],
    thinking: [3500, 7000], searching: [1600, 4000], working: [2800, 5500],
    excited: [2000, 4000], surprised: [1800, 3500], suspicious: [4500, 8000],
    angry: [3500, 7000], drowsy: null, happy: [2500, 5000], curious: [2500, 5500],
    confused: [2800, 5500], bored: [4000, 8000], proud: [3500, 7000],
    shy: [3000, 6000], sad: [4000, 8000], laughing: [2500, 5000],
    scared: [1200, 3000], playful: [2000, 4500], celebrate: [2200, 4500],
    orbit: null, radar: null, progress: null, spawning: null, humming: [4000, 8000],
    loading: null, dictating: null, sending: null, receiving: null, uploading: null,
    writing: null, notifying: [2000, 4000], alerting: null, bouncing: null,
    dragging: [2200, 4500], "powering-down": null,
  };

  const ONBOARDING = ["curious", "happy", "playful", "excited", "listening", "proud", "laughing", "shy"];
  const ONBOARDING_MS = 1200;
  const onboardMood = (n) => (n % 2 === 0 ? "idle" : ONBOARDING[((n - 1) / 2) % ONBOARDING.length] ?? "idle");

  const SPRINGS = {
    spin: [5, 0.9],
    x: [3.5, 1],
    y: [4, 1],
    squash: [10, 0.8],
    blink: [26, 1],
    eyeScale: [9, 0.85],
    gazeX: [13, 1],
    gazeY: [13, 1],
    notify: [9, 0.55],
    humDots: [6, 1],
    overlay: [14, 1],
    overlayMix: [11, 1],
    shape: [10, 1],
    overlayTurn: [14, 1],
    spinTurn: [6.2, 1],
  };

  const FACE_TUNE = { size: 0.86, gap: 1.18, height: 1, eyeWidth: 0.96, eyeHeight: 0.92 };
  const POSE = { turn: 17, tilt: -14, roll: 29, scale: 1 };
  const POSE_HOME = { turn: 33, tilt: -19, roll: 38 };
  const UNIFORM_EYES = true;
  const V_T = new Set(["happy", "excited", "proud"]);
  const B_T = new Set(["playful"]);
  const WINK_STATES = new Set(["idle", "happy", "excited", "curious", "playful"]);
  const SHAPE_ZOOM = { blob: 0.92, pebble: 0.96, squircle: 0.84, tablet: 1, wedge: 0.94, hex: 0.94, cloud: 1, teardrop: 1 };
  const VIEW_SCALE = 259 / 229;
  const shapeZoom = (name) => SHAPE_ZOOM[name] ?? 1;
  const poseScale = (name) => shapeZoom(name) * VIEW_SCALE;
  const shapeEyeScale = (name) => SHAPE_ZOOM.blob / shapeZoom(name);
  const VIEW = { minX: -15, minY: -15, width: 259, height: 259 };
  const VIEW_HALF = VIEW.width / 2;
  const VIEW_MID = VIEW.minX + VIEW_HALF;
  const OVERLAY_ZOOM = {
    dots: 1.5, orbit: 1.14, radar: 1.14, progress: 1.32, gather: 1.15,
    wave: 1.42, send: 1.12, receive: 1.12, dock: 1.3, ball: 1.22,
    whirl: 1.45, pencil: 1.18, bang: 1.28, standby: 1.75,
  };
  const overlayViewZoom = (kind, scale) => (kind == null ? 1 : Math.max(OVERLAY_ZOOM[kind] / Math.max(scale, 1), 1));

  // Source G_t / MNe / Y_t — login ink. Live $_t uses --fg = ink.flat ?? MNe(color).
  const INK = {
    black: { lightFrom: "#585858", lightTo: "#000000", darkFrom: "#FFFFFF", darkTo: "#C2C2C2" },
    brown: { lightFrom: "#AE8968", lightTo: "#855C36", darkFrom: "#A27952", darkTo: "#604227" },
    red: { lightFrom: "#FF5667", lightTo: "#E02135", darkFrom: "#FF3E51", darkTo: "#A21826" },
    orange: { lightFrom: "#FF8838", lightTo: "#E05B00", darkFrom: "#FF781C", darkTo: "#C24E00" },
    yellow: { lightFrom: "#FFAF38", lightTo: "#E08600", darkFrom: "#FFA31C", darkTo: "#C27400" },
    green: { lightFrom: "#1CCF82", lightTo: "#009957", darkFrom: "#00C972", darkTo: "#008048" },
    cyan: { lightFrom: "#58D3C5", lightTo: "#00A592", darkFrom: "#1CC3B0", darkTo: "#007769" },
    blue: { lightFrom: "#459FFE", lightTo: "#0E74E0", darkFrom: "#2A92FE", darkTo: "#0C64C1" },
    violet: { lightFrom: "#B792FE", lightTo: "#804EE0", darkFrom: "#9159FE", darkTo: "#5C39A1" },
    magenta: { lightFrom: "#FF77BE", lightTo: "#E02A88", darkFrom: "#FF47A6", darkTo: "#A21E62" },
    gray: { lightFrom: "#A6A6A6", lightTo: "#696969", darkFrom: "#B7B7B7", darkTo: "#777777" },
  };
  const INK_ANGLE = 135;
  const inkFg = (id) => {
    const pal = g.GROK_GEO.palette[id] || g.GROK_GEO.palette.black;
    return `light-dark(${pal.light}, ${pal.dark})`;
  };
  const inkCss = (id) => {
    const e = INK[id] || INK.black;
    return `linear-gradient(${INK_ANGLE + 90}deg, light-dark(${e.lightFrom}, ${e.darkFrom}), light-dark(${e.lightTo}, ${e.darkTo}))`;
  };
  const EYE_BG = "var(--sand-bg-base, var(--disk, #f3efe6))";

  g.GROK_TABLES = {
    GROUPS, EYE_PLAYLIST, EYE_HOLD_MS, BLINK_MS,
    ONBOARDING, ONBOARDING_MS, onboardMood,
    SPRINGS, FACE_TUNE, POSE, POSE_HOME, UNIFORM_EYES,
    V_T, B_T, WINK_STATES,
    SHAPE_ZOOM, VIEW_SCALE, shapeZoom, poseScale, shapeEyeScale,
    VIEW, VIEW_HALF, VIEW_MID, OVERLAY_ZOOM, overlayViewZoom,
    INK, INK_ANGLE, inkFg, inkCss, EYE_BG,
  };
})(window);
