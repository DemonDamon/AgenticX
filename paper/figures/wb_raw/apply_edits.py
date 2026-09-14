#!/usr/bin/env python3
"""Apply revised-statistics edits to exported whiteboard raw JSONs (fig1/fig2/fig4).

Values verified against the paper's unified estimator (geometric mean over
nonzero paired ratios, zeros excluded & reported as counts):
  Flash: last 0.69, concat 0.91, blackboard 0.81, integrator 1.55
  K3:    last 0.66, concat 0.88, blackboard 0.72, integrator 1.50
Team-arm mean range 0.46 (Flash) / 0.49 (K3) vs single-arm 0.025 (~19x).
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent

def set_text(nodes, idx, new_text, x=None, width=None):
    n = nodes[idx]
    assert isinstance(n.get("text"), dict), f"node {idx} has no text"
    old = n["text"]["text"]
    n["text"]["text"] = new_text
    if x is not None:
        n["x"] = x
    if width is not None:
        n["width"] = width
    print(f"  [{idx}] {old!r} -> {new_text!r}" + (f" x={x}" if x is not None else "") + (f" w={width}" if width is not None else ""))

def set_geom(nodes, idx, width):
    n = nodes[idx]
    old = n["width"]
    n["width"] = width
    print(f"  [{idx}] width {old} -> {width}")

def load(fn):
    d = json.load(open(BASE / fn))
    return d, d["nodes"]

def save(fn, d):
    with open(BASE / fn, "w") as f:
        json.dump(d, f, ensure_ascii=False)
    print(f"saved {fn}")

# ---------------- fig1 (overview) ----------------
print("== fig1 (Mm5Lwn7uIhf4libUVBgcKtHxnYf) ==")
d, ns = load("fig1.json")
set_text(ns, 124, "0.66")                       # K3 last-role CTR (span min)
set_text(ns, 188, "1.55")                       # max integrator CTR (Flash)
set_text(ns, 186, "ARM-MEAN QUALITY RANGE (Q)") # was VARIANCE IN QUALITY Q EXPLAINED BY
set_text(ns, 64, "0.46\u20130.49", width=170)   # was 40-43% (team-arm range)
set_text(ns, 19, "0.025", width=60)             # was <= 0.3% (single-arm range)
save("fig1.json", d)

# ---------------- fig2 (assembly mechanism) ----------------
print("== fig2 (ROj8wC9C5hjlINbUeURcsRRHnPc) ==")
d, ns = load("fig2.json")
# K3 bar labels (Flash row unchanged: 0.69 / 0.91 / 0.81 / 1.55)
set_text(ns, 54, "0.66", x=1262)    # K3 last (bar node 10)
set_text(ns, 75, "0.88", x=1313)    # K3 concat (bar node 3)
set_text(ns, 12, "0.72", x=1276)    # K3 blackboard (bar node 91)
set_text(ns, 45, "1.50", x=1457)    # K3 integrator (bar node 98)
# K3 bar widths (origin x=1100, 233.3 px per CTR unit)
set_geom(ns, 10, 154)               # 0.659
set_geom(ns, 3, 205)                # 0.879
set_geom(ns, 91, 168)               # 0.722
set_geom(ns, 98, 349)               # 1.496
set_text(ns, 71, "Protocol alone swings CTR_matched from 0.66 to 1.55 \u2014 over identical role outputs")
save("fig2.json", d)

# ---------------- fig4 (assembly x coupling + variance panel) ----------------
print("== fig4 (Q6yIwWLySh83dqbuH3XcItwPnad) ==")
d, ns = load("q6yi.json")
# panel (c) header / axis
set_text(ns, 178, "(c) Range of arm means")
set_text(ns, 37, "Range (Q)", width=80)
set_text(ns, 187, "Range of arm-mean quality Q", width=230)
set_text(ns, 28, "0.15", width=35)
set_text(ns, 1, "0.30", width=35)
set_text(ns, 61, "0.45", width=35)
# bar value labels (axis: 0 at x~1377, 6.69 px per 0.01 -> 669 px per 1.0)
set_text(ns, 97, "0.46", x=1692)    # Flash team-arm range (bar 38)
set_text(ns, 161, "0.49", x=1712)   # K3 team-arm range (bar 43)
set_text(ns, 160, "0.025", width=64)  # Flash single-arm range (bar 171)
set_text(ns, 153, "0.025", width=64)  # K3 single-arm range (bar 39)
# bar widths (origin x=1378; 0.46 -> 307, 0.49 -> 327)
set_geom(ns, 38, 307)
set_geom(ns, 43, 327)
# annotation block
set_text(ns, 40, "\u224819\u00d7")
set_text(ns, 51, "range gap")
set_text(ns, 129, "(team arms 0.42\u20130.91 \u00b7 single arms 0.58\u20130.64)", width=300)
set_text(ns, 62, "compute bars (0.025) shown at minimum visible length")
save("q6yi.json", d)

print("done")
