/* L4 — springs, easing, path flatten, span, 3D. From index-UbX-y3il.js xl / $Be / l_t / gm. */
(function (g) {
  const spring = (x) => ({ x, v: 0, t: x });
  const stepSpring = (s, freq, damp, dt) => {
    s.v += (-2 * damp * freq * s.v - freq * freq * (s.x - s.t)) * dt;
    s.x += s.v * dt;
    if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) {
      s.x = s.t;
      s.v = 0;
    }
  };
  const DT = 1 / 120;
  const springSteps = (dt) => Math.max(1, Math.ceil(dt / DT));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const sign = () => (Math.random() < 0.5 ? -1 : 1);
  const K2 = (n) => (n < 0.5 ? 4 * n * n * n : 1 - Math.pow(-2 * n + 2, 3) / 2);
  const Rc = (n) => 1 - Math.pow(1 - n, 3);
  const y1e = (n) => 1 + 2.70158 * Math.pow(n - 1, 3) + 1.70158 * Math.pow(n - 1, 2);
  const Dke = (n) => n * n * (3 - 2 * n);
  const x_t = (n, e) => 1 - Math.exp(Math.log(1 - n) * 60 * e);
  const Rn = (n, bs = 1 / 60) => x_t(n, bs);

  const polyPath = (pts) =>
    "M" + pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("L") + "Z";
  const centroid = (pts) => {
    let x = 0, y = 0;
    for (const p of pts) {
      x += p[0];
      y += p[1];
    }
    return [x / pts.length, y / pts.length];
  };
  const lerpPoly = (a, b, t) =>
    a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);
  const lerpFace = (n, e, t) => ({
    x: n.x + (e.x - n.x) * t,
    y: n.y + (e.y - n.y) * t,
    sx: n.sx + (e.sx - n.sx) * t,
    sy: n.sy + (e.sy - n.sy) * t,
    eye: n.eye + (e.eye - n.eye) * t,
    leftDX: (n.leftDX ?? 0) + ((e.leftDX ?? 0) - (n.leftDX ?? 0)) * t,
  });

  function flattenPath(d, e = 4) {
    const t = d.match(/[MLCQZmlcqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
    const s = [];
    let r = 0, i = "", o = 0, l = 0, c = 0, u = 0;
    const rd = () => parseFloat(t[r++]);
    const m = (f, h) => {
      const y = Math.max(2, Math.ceil(h / e));
      for (let k = 1; k <= y; k++) s.push(f(k / y));
    };
    while (r < t.length) {
      if (/[a-z]/i.test(t[r])) i = t[r++].toUpperCase();
      if (i === "Z") {
        if (Math.hypot(c - o, u - l) > 0.01) m((f) => [o + (c - o) * f, l + (u - l) * f], Math.hypot(c - o, u - l));
        o = c;
        l = u;
        continue;
      }
      if (r >= t.length) break;
      if (i === "M") {
        o = rd();
        l = rd();
        c = o;
        u = l;
        s.push([o, l]);
        i = "L";
      } else if (i === "L") {
        const f = rd(), h = rd();
        m((y) => [o + (f - o) * y, l + (h - l) * y], Math.hypot(f - o, h - l));
        o = f;
        l = h;
      } else if (i === "Q") {
        const f = rd(), h = rd(), y = rd(), k = rd(), v = o, b = l;
        m((x) => {
          const N = 1 - x;
          return [N * N * v + 2 * N * x * f + x * x * y, N * N * b + 2 * N * x * h + x * x * k];
        }, Math.hypot(f - o, h - l) + Math.hypot(y - f, k - h));
        o = y;
        l = k;
      } else if (i === "C") {
        const f = rd(), h = rd(), y = rd(), k = rd(), v = rd(), b = rd(), x = o, N = l;
        m((E) => {
          const A = 1 - E;
          return [
            A * A * A * x + 3 * A * A * E * f + 3 * A * E * E * y + E * E * E * v,
            A * A * A * N + 3 * A * A * E * h + 3 * A * E * E * k + E * E * E * b,
          ];
        }, Math.hypot(f - o, h - l) + Math.hypot(y - f, k - h) + Math.hypot(v - y, b - k));
        o = v;
        l = b;
      } else r++;
    }
    return s;
  }

  function buildSpan(pts, Re, e = 160) {
    let t = Infinity, s = -Infinity;
    for (const m of pts) {
      if (m[1] < t) t = m[1];
      if (m[1] > s) s = m[1];
    }
    const r = s - t;
    const i = (m) => t + r * (m + 0.5) / e;
    const o = new Float64Array(e);
    const l = new Float64Array(e);
    for (let m = 0; m < e; m++) {
      const f = i(m);
      let h = -Infinity, y = Infinity;
      for (let b = 0; b < pts.length; b++) {
        const x = pts[b], N = pts[(b + 1) % pts.length];
        if (x[1] <= f === N[1] <= f) continue;
        const E = x[0] + (N[0] - x[0]) * (f - x[1]) / (N[1] - x[1]);
        if (E <= Re) {
          if (E > h) h = E;
        } else if (E < y) y = E;
      }
      o[m] = Number.isFinite(h) ? h : Re;
      l[m] = Number.isFinite(y) ? y : Re;
    }
    return (h) => {
      const y = clamp((h - t) / r * e - 0.5, 0, e - 1);
      const k = Math.floor(y);
      const v = y - k;
      const b = Math.min(k + 1, e - 1);
      return [o[k] + (o[b] - o[k]) * v, l[k] + (l[b] - l[k]) * v];
    };
  }

  const spanCache = new Map();
  function spanAt(path, Re) {
    const key = path;
    let fn = spanCache.get(key);
    if (!fn) {
      fn = buildSpan(flattenPath(path), Re);
      spanCache.set(key, fn);
    }
    return fn;
  }

  // Source z_t — live span of a polyline at Y (used while shape-morphing)
  function spanPoly(n, e, Re) {
    let t = -Infinity, s = Infinity;
    for (let r = 0; r < n.length; r++) {
      const i = n[r], o = n[(r + 1) % n.length];
      if (i[1] <= e === o[1] <= e) continue;
      const l = i[0] + (o[0] - i[0]) * (e - i[1]) / (o[1] - i[1]);
      if (l <= Re) {
        if (l > t) t = l;
      } else if (l < s) s = l;
    }
    return [Number.isFinite(t) ? t : Re, Number.isFinite(s) ? s : Re];
  }

  function rot3(turn, tilt, roll) {
    const d = Math.PI / 180;
    const Ui = Math.cos(turn * d), Si = Math.sin(turn * d);
    const Ea = Math.cos(tilt * d), Ca = Math.sin(tilt * d);
    const Wo = Math.cos(roll * d), _c = Math.sin(roll * d);
    return [
      Wo * Ui - _c * Ca * Si, -_c * Ea, Wo * Si + _c * Ca * Ui,
      _c * Ui + Wo * Ca * Si, Wo * Ea, _c * Si - Wo * Ca * Ui,
      -Ea * Si, Ca, Ea * Ui,
    ];
  }

  function relRot(pose, home) {
    const gn = rot3(pose.turn, pose.tilt, pose.roll);
    const Gn = rot3(home.turn, home.tilt, home.roll);
    return [
      gn[0] * Gn[0] + gn[1] * Gn[1] + gn[2] * Gn[2],
      gn[0] * Gn[3] + gn[1] * Gn[4] + gn[2] * Gn[5],
      gn[0] * Gn[6] + gn[1] * Gn[7] + gn[2] * Gn[8],
      gn[3] * Gn[0] + gn[4] * Gn[1] + gn[5] * Gn[2],
      gn[3] * Gn[3] + gn[4] * Gn[4] + gn[5] * Gn[5],
      gn[3] * Gn[6] + gn[4] * Gn[7] + gn[5] * Gn[8],
      gn[6] * Gn[0] + gn[7] * Gn[1] + gn[8] * Gn[2],
      gn[6] * Gn[3] + gn[7] * Gn[4] + gn[8] * Gn[5],
      gn[6] * Gn[6] + gn[7] * Gn[7] + gn[8] * Gn[8],
    ];
  }

  // Source HBe — silhouette radii of a solid-of-revolution at yaw `angle`.
  function solidRadii(solid, angle, n = 96) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const r = solid.map(([x, y, z, rad]) => [x * c + z * s, y, rad]);
    const raw = Array.from({ length: n }, (_, idx) => {
      const u = (idx / n) * Math.PI * 2;
      const d = Math.cos(u), m = Math.sin(u);
      let f = 0;
      for (const [h, y, k] of r) {
        const v = d * h + m * y;
        const b = v * v - (h * h + y * y) + k * k;
        if (b <= 0) continue;
        const x = v + Math.sqrt(b);
        if (x > f) f = x;
      }
      return f;
    });
    const o = raw.length;
    return raw.map((l, i) => (
      raw[(i - 2 + o) % o] + 4 * raw[(i - 1 + o) % o] + 6 * raw[i]
      + 4 * raw[(i + 1) % o] + raw[(i + 2) % o]
    ) / 16);
  }

  // Source Po().turnAt — scale the polar ring by HBe(yaw)/HBe(0).
  function makeTurnAt(solid, ring, Re) {
    const rest = solidRadii(solid, 0);
    return (yaw) => {
      let v = solidRadii(solid, yaw).map((x, i) => clamp((x + 12) / (rest[i] + 12), 0.32, 1.5));
      const n = v.length;
      for (let p = 0; p < 3; p++) {
        const prev = v;
        v = prev.map((E, A) => (
          prev[(A - 2 + n) % n] + 4 * prev[(A - 1 + n) % n] + 6 * prev[A]
          + 4 * prev[(A + 1) % n] + prev[(A + 2) % n]
        ) / 16);
      }
      return ring.map(([x, y], i) => [Re + (x - Re) * v[i], Re + (y - Re) * v[i]]);
    };
  }

  // Source _Fe — map a pointer onto an ellipse around the mark
  function mapPointer(rect, pt, JFe = 0.6, iin = 22, ain = 14, oin = 2) {
    const t = rect.left + rect.width / 2;
    const s = rect.top + rect.height / 2;
    const r = pt.x - t, i = pt.y - s;
    const o = Math.min(1, Math.sqrt(Math.hypot(r, i) / (rect.width * oin)));
    const l = Math.atan2(i, r);
    return {
      x: t + JFe * (ain / iin) * o * Math.cos(l) * rect.width,
      y: s + JFe * o * Math.sin(l) * rect.height,
    };
  }

  g.GROK_MATH = {
    spring, stepSpring, DT, springSteps,
    clamp, lerp, rand, sign, K2, Rc, y1e, Dke, x_t, Rn,
    polyPath, centroid, lerpPoly, lerpFace,
    flattenPath, buildSpan, spanAt, spanPoly,
    rot3, relRot, mapPointer, solidRadii, makeTurnAt,
  };
})(window);
