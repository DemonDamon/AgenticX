#!/usr/bin/env python3
"""Generate AgenticX architecture diagrams (zh/en) as Feishu-whiteboard-friendly SVG.

Brand marks come from simple-icons (CC0), cached in icons/simple_icons.json.

Author: Damon Li
"""
import json
import os
import sys

_ICON_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons", "simple_icons.json")
ICONS = json.load(open(_ICON_FILE)) if os.path.exists(_ICON_FILE) else {}
# Brand colors too dark for the warm-black canvas are lifted to readable tones.
BADGE_COLOR_OVERRIDE = {"react": "#1B8DB8", "electron": "#2F6F7A"}
ICON_COLOR_OVERRIDE = {
    "opentelemetry": "#FFF7ED", "modelcontextprotocol": "#FFF7ED", "nextdotjs": "#FFF7ED",
    "json": "#FFF7ED", "sqlite": "#7FC4E8", "mysql": "#6FA8D6",
}

FONT = "Noto Sans SC"
BG = "#0C0A08"
PANEL = "#15100C"
PANEL_EXT = "#110D0A"
CARD = "#1E1611"
CARD_HI = "#2E1B0D"
OR = "#F97316"
OR2 = "#FB923C"
OR3 = "#FDBA74"
DEEP = "#7C3A12"
CREAM = "#FFF7ED"
MUTED = "#CFC4B8"
DIM = "#8C8178"
PLAN = "#6E655C"
THIN = "#E8B98A"


def tw(s, size):
    w = 0.0
    for c in s:
        w += size if ord(c) > 0x2E80 else size * 0.6
    return w


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class R:
    """A text line prefixed by inline brand icons."""

    def __init__(self, slugs, text):
        self.slugs = [slugs] if isinstance(slugs, str) else list(slugs)
        self.text = text


class D:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.els = []

    def add(self, s):
        self.els.append(s)

    def rect(self, x, y, w, h, fill=CARD, stroke=DEEP, sw=1, rx=10, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        st = f'stroke="{stroke}" stroke-width="{sw}"' if stroke else 'stroke="none"'
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" {st}{d}/>')

    def text(self, x, y, s, size=13, fill=MUTED, weight="normal", anchor="start"):
        self.add(
            f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}">{esc(s)}</text>'
        )

    def line(self, x, y, s, size=13, fill=MUTED, weight="normal", anchor="middle"):
        if not isinstance(s, R):
            self.text(x, y, s, size, fill, weight, anchor)
            return
        isz = round(size * 1.38, 1)
        ig = 3
        iw = len(s.slugs) * isz + (len(s.slugs) - 1) * ig + 6
        total = iw + tw(s.text, size)
        x0 = x - total / 2 if anchor == "middle" else x
        iy = y - size * 0.36 - isz / 2
        for i, sl in enumerate(s.slugs):
            self.icon(sl, x0 + i * (isz + ig), iy, isz)
        self.text(x0 + iw, y, s.text, size, fill, weight, "start")

    def lines_c(self, cx, y, lines, size=13, fill=MUTED, step=None, weight="normal"):
        step = step or size + 6
        for i, s in enumerate(lines):
            self.text(cx, y + i * step, s, size, fill, weight, "middle")

    def tag(self, x, y, s, variant="impl"):
        size = 11
        w = tw(s, size) + 18
        if variant == "plan":
            self.rect(x, y, w, 20, fill="#1A1714", stroke=PLAN, sw=1, rx=10, dash="4 3")
            self.text(x + w / 2, y + 14, s, size, DIM, "normal", "middle")
        elif variant == "ext":
            self.rect(x, y, w, 20, fill="#1C140D", stroke=OR3, sw=1, rx=10)
            self.text(x + w / 2, y + 14, s, size, OR3, "normal", "middle")
        else:
            self.rect(x, y, w, 20, fill="#3A1E0C", stroke=OR, sw=1, rx=10)
            self.text(x + w / 2, y + 14, s, size, OR3, "bold", "middle")
        return w

    def container(self, x, y, w, h, title, status=None, variant="impl", title_size=17, tag_variant=None, icons=()):
        if variant == "impl":
            self.rect(x, y, w, h, fill=PANEL, stroke=OR, sw=1.6, rx=16)
            tc = OR3
        elif variant == "ext":
            self.rect(x, y, w, h, fill=PANEL_EXT, stroke=OR3, sw=1.2, rx=16)
            tc = OR3
        elif variant == "plan":
            self.rect(x, y, w, h, fill="#12100E", stroke=PLAN, sw=1.4, rx=16, dash="8 5")
            tc = MUTED
        elif variant == "boundary":
            self.rect(x, y, w, h, fill="#0F0C0A", stroke="#4A3F36", sw=1.4, rx=22)
            tc = MUTED
        else:
            raise ValueError(variant)
        if title:
            self.add(f'<rect x="{x + 16}" y="{y + 15}" width="4" height="18" rx="2" fill="{OR if variant != "plan" else PLAN}"/>')
            tx = x + 28
            isz = round(title_size * 1.3, 1)
            for sl in icons:
                self.icon(sl, tx, y + 30 - title_size * 0.36 - isz / 2, isz)
                tx += isz + 6
            self.text(tx, y + 30, title, title_size, tc if variant != "impl" else CREAM, "bold")
            if status:
                self.tag(tx + tw(title, title_size) + 12, y + 14, status, tag_variant or ("plan" if variant == "plan" else ("ext" if variant == "ext" else "impl")))

    def card(self, x, y, w, h, title, lines=(), variant="impl", title_size=15, line_size=12.5, sub=None):
        if variant == "hub":
            self.rect(x, y, w, h, fill=CARD_HI, stroke=OR, sw=2, rx=12)
            tcol = CREAM
        elif variant == "ext":
            self.rect(x, y, w, h, fill="#17110C", stroke=OR3, sw=1, rx=12)
            tcol = CREAM
        elif variant == "plan":
            self.rect(x, y, w, h, fill="#16130F", stroke=PLAN, sw=1.2, rx=12, dash="6 4")
            tcol = MUTED
        elif variant == "future":
            self.rect(x, y, w, h, fill="#12100E", stroke="#4E4740", sw=1, rx=12, dash="4 4")
            tcol = DIM
        else:
            self.rect(x, y, w, h, fill=CARD, stroke=DEEP, sw=1.2, rx=12)
            tcol = CREAM
        cx = x + w / 2
        tl = title if isinstance(title, (list, tuple)) else [title]
        n = len(tl) + len(lines)
        step_t = title_size + 5
        step_l = line_size + 7
        total = len(tl) * step_t + len(lines) * step_l
        if sub:
            total += step_l
        y0 = y + (h - total) / 2 + title_size * 0.85
        for i, s in enumerate(tl):
            self.line(cx, y0 + i * step_t, s, title_size, tcol, "bold")
        yy = y0 + len(tl) * step_t - title_size * 0.85 + line_size * 0.85 + 2
        if sub:
            self.line(cx, yy, sub, line_size - 0.5, OR3, "normal")
            yy += step_l
        for i, s in enumerate(lines):
            self.line(cx, yy + i * step_l, s, line_size, MUTED if variant not in ("plan", "future") else DIM, "normal")

    def cyl(self, x, y, w, h, title, lines=(), variant="impl", title_size=15, line_size=12):
        e = 12
        stroke = OR if variant == "impl" else OR3
        fill = CARD
        self.add(f'<ellipse cx="{x + w / 2}" cy="{y + h - e}" rx="{w / 2}" ry="{e}" fill="{fill}" stroke="{stroke}" stroke-width="1.4"/>')
        self.add(f'<rect x="{x}" y="{y + e}" width="{w}" height="{h - 2 * e}" fill="{fill}" stroke="none"/>')
        self.add(f'<polyline points="{x},{y + e} {x},{y + h - e}" fill="none" stroke="{stroke}" stroke-width="1.4"/>')
        self.add(f'<polyline points="{x + w},{y + e} {x + w},{y + h - e}" fill="none" stroke="{stroke}" stroke-width="1.4"/>')
        self.add(f'<ellipse cx="{x + w / 2}" cy="{y + e}" rx="{w / 2}" ry="{e}" fill="#3A1E0C" stroke="{stroke}" stroke-width="1.4"/>')
        cx = x + w / 2
        tl = title if isinstance(title, (list, tuple)) else [title]
        y0 = y + 2 * e + 22
        for i, s in enumerate(tl):
            self.line(cx, y0 + i * (title_size + 5), s, title_size, CREAM, "bold")
        yy = y0 + len(tl) * (title_size + 5) + 4
        for i, s in enumerate(lines):
            self.line(cx, yy + i * (line_size + 7), s, line_size, MUTED, "normal")

    def file_node(self, x, y, w, h, title, lines=(), title_size=15, line_size=12):
        f = 18
        self.add(
            f'<path d="M{x + 10} {y} L{x + w - f} {y} L{x + w} {y + f} L{x + w} {y + h - 10} '
            f'Q{x + w} {y + h} {x + w - 10} {y + h} L{x + 10} {y + h} Q{x} {y + h} {x} {y + h - 10} '
            f'L{x} {y + 10} Q{x} {y} {x + 10} {y} Z" fill="{CARD}" stroke="{OR}" stroke-width="1.4"/>'
        )
        self.add(f'<polyline points="{x + w - f},{y} {x + w - f},{y + f} {x + w},{y + f}" fill="none" stroke="{OR}" stroke-width="1.4"/>')
        cx = x + w / 2
        tl = title if isinstance(title, (list, tuple)) else [title]
        y0 = y + 40
        for i, s in enumerate(tl):
            self.line(cx, y0 + i * (title_size + 5), s, title_size, CREAM, "bold")
        yy = y0 + len(tl) * (title_size + 5) + 4
        for i, s in enumerate(lines):
            self.line(cx, yy + i * (line_size + 7), s, line_size, MUTED, "normal")

    def pill(self, x, y, w, h, lines, size=12.5, variant="impl", sub=None, bold=False):
        if variant == "hub":
            self.rect(x, y, w, h, fill=CARD_HI, stroke=OR, sw=1.6, rx=h / 2 if h < 44 else 12)
        elif variant == "ext":
            self.rect(x, y, w, h, fill="#17110C", stroke=OR3, sw=1, rx=10)
        elif variant == "plain":
            self.rect(x, y, w, h, fill="#1A130E", stroke="#5A3B24", sw=1, rx=10)
        else:
            self.rect(x, y, w, h, fill=CARD, stroke=DEEP, sw=1.2, rx=10)
        lines = lines if isinstance(lines, (list, tuple)) else [lines]
        step = size + 5
        total = len(lines) * step + (size + 3 if sub else 0)
        y0 = y + (h - total) / 2 + size * 0.85
        for i, s in enumerate(lines):
            self.line(x + w / 2, y0 + i * step, s, size, CREAM, "bold" if (bold or variant == "hub") else "normal")
        if sub:
            self.line(x + w / 2, y0 + len(lines) * step, sub, size - 2, OR3, "normal")

    def _head(self, x1, y1, x2, y2, size, color):
        if x1 == x2:
            d = 1 if y2 > y1 else -1
            pts = [(x2, y2), (x2 - size * 0.6, y2 - d * size), (x2 + size * 0.6, y2 - d * size)]
        else:
            d = 1 if x2 > x1 else -1
            pts = [(x2, y2), (x2 - d * size, y2 - size * 0.6), (x2 - d * size, y2 + size * 0.6)]
        p = " ".join(f"{a},{b}" for a, b in pts)
        self.add(f'<polygon points="{p}" fill="{color}" stroke="none"/>')

    def wire(self, pts, kind="thin", end=True, start=False):
        if kind == "main":
            color, sw, hs, dash = OR, 4, 13, None
        elif kind == "thin":
            color, sw, hs, dash = THIN, 1.5, 8, None
        elif kind == "dash":
            color, sw, hs, dash = PLAN, 1.5, 8, "6 5"
        elif kind == "dash_or":
            color, sw, hs, dash = OR3, 1.5, 8, "6 5"
        else:
            raise ValueError(kind)
        # shorten endpoints so the arrow head sits exactly on target
        p = [list(q) for q in pts]
        if end:
            self._trim(p, -1, hs * 0.8)
        if start:
            self._trim(p, 0, hs * 0.8)
        pp = " ".join(f"{a},{b}" for a, b in p)
        dd = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<polyline points="{pp}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linejoin="round"{dd}/>')
        if end:
            self._head(pts[-2][0], pts[-2][1], pts[-1][0], pts[-1][1], hs, color)
        if start:
            self._head(pts[1][0], pts[1][1], pts[0][0], pts[0][1], hs, color)

    @staticmethod
    def _trim(p, idx, n):
        a = p[idx]
        b = p[idx - 1] if idx == -1 else p[1]
        if a[0] == b[0]:
            a[1] += -n if a[1] > b[1] else n
        else:
            a[0] += -n if a[0] > b[0] else n

    def label(self, cx, cy, s, size=11.5, color=MUTED, bg=BG, anchor="middle"):
        lines = s if isinstance(s, (list, tuple)) else [s]
        w = max(tw(l, size) for l in lines) + 12
        h = len(lines) * (size + 5) + 6
        x = cx - w / 2 if anchor == "middle" else cx
        self.rect(x, cy - h / 2, w, h, fill=bg, stroke=None, rx=4)
        for i, l in enumerate(lines):
            self.text(x + w / 2, cy - h / 2 + 3 + size * 0.95 + i * (size + 5), l, size, color, "normal", "middle")

    def header(self, title, subtitle):
        self.add(f'<rect x="40" y="30" width="6" height="44" rx="3" fill="{OR}"/>')
        self.text(60, 58, title, 30, CREAM, "bold")
        self.text(60, 82, subtitle, 13.5, DIM)

    def legend(self, x, y, items):
        # items: list of (kind, text); kind in box_impl/box_ext/box_plan/box_future/main/thin/dash
        col_w = 190
        for i, (kind, s) in enumerate(items):
            cx = x + (i % 3) * col_w
            cy = y + (i // 3) * 26
            if kind == "box_impl":
                self.rect(cx, cy - 8, 26, 16, fill=CARD, stroke=OR, sw=1.4, rx=4)
            elif kind == "box_ext":
                self.rect(cx, cy - 8, 26, 16, fill="#17110C", stroke=OR3, sw=1, rx=4)
            elif kind == "box_plan":
                self.rect(cx, cy - 8, 26, 16, fill="#16130F", stroke=PLAN, sw=1.2, rx=4, dash="4 3")
            elif kind == "box_future":
                self.rect(cx, cy - 8, 26, 16, fill="#12100E", stroke="#4E4740", sw=1, rx=4, dash="3 3")
            elif kind == "main":
                self.add(f'<polyline points="{cx},{cy} {cx + 26},{cy}" fill="none" stroke="{OR}" stroke-width="4"/>')
            elif kind == "thin":
                self.add(f'<polyline points="{cx},{cy} {cx + 26},{cy}" fill="none" stroke="{THIN}" stroke-width="1.5"/>')
            elif kind == "dash":
                self.add(f'<polyline points="{cx},{cy} {cx + 26},{cy}" fill="none" stroke="{PLAN}" stroke-width="1.5" stroke-dasharray="6 5"/>')
            self.text(cx + 34, cy + 4.5, s, 12, MUTED)

    def person(self, cx, cy, color=OR3):
        self.add(f'<circle cx="{cx}" cy="{cy - 9}" r="7" fill="none" stroke="{color}" stroke-width="1.8"/>')
        self.add(f'<path d="M{cx - 12} {cy + 12} Q{cx - 12} {cy + 1} {cx} {cy + 1} Q{cx + 12} {cy + 1} {cx + 12} {cy + 12}" fill="none" stroke="{color}" stroke-width="1.8"/>')

    def app_icon(self, cx, cy, color=OR3):
        self.rect(cx - 11, cy - 11, 22, 22, fill="none", stroke=color, sw=1.8, rx=5)
        self.add(f'<polyline points="{cx - 5},{cy - 3} {cx - 1},{cy + 1} {cx - 5},{cy + 5}" fill="none" stroke="{color}" stroke-width="1.6"/>')
        self.add(f'<polyline points="{cx + 1},{cy + 5} {cx + 6},{cy + 5}" fill="none" stroke="{color}" stroke-width="1.6"/>')

    def cloud(self, x, y, w, h, stroke=OR3, fill="#17110C"):
        shapes = [
            ("rect", x, y + h * 0.42, w, h * 0.58, h * 0.29),
            ("circle", x + w * 0.30, y + h * 0.46, h * 0.30),
            ("circle", x + w * 0.54, y + h * 0.36, h * 0.36),
            ("circle", x + w * 0.76, y + h * 0.52, h * 0.26),
        ]
        for inset, st in ((0, True), (1.4, False)):
            for sh in (shapes if st else shapes[1:] + shapes[:1]):
                sa = f'stroke="{stroke}" stroke-width="2.8"' if st else 'stroke="none"'
                if sh[0] == "rect":
                    _, rx_, ry_, rw, rh, rr = sh
                    self.add(f'<rect x="{rx_ + inset}" y="{ry_ + inset}" width="{rw - 2 * inset}" height="{rh - 2 * inset}" rx="{rr}" fill="{fill}" {sa}/>')
                else:
                    _, cx_, cy_, r = sh
                    self.add(f'<circle cx="{cx_}" cy="{cy_}" r="{r - inset}" fill="{fill}" {sa}/>')

    def icon(self, slug, x, y, size=24, badge=True):
        ic = ICONS.get(slug)
        if not ic:
            return
        if badge:
            self.rect(x, y, size, size, fill="#FFF7ED", stroke=OR2, sw=1, rx=size * 0.26)
            pad = size * 0.17
        else:
            pad = 0
        inner = size - 2 * pad
        k = inner / 24.0
        color = BADGE_COLOR_OVERRIDE.get(slug, "#" + ic["hex"]) if badge else ICON_COLOR_OVERRIDE.get(slug, "#" + ic["hex"])
        self.add(f'<path d="{ic["d"]}" fill="{color}" transform="translate({x + pad} {y + pad}) scale({k:.4f})"/>')

    def icons_at(self, slugs, x, y, size=24, gap=6, align="right"):
        total = len(slugs) * size + (len(slugs) - 1) * gap
        x0 = x - total if align == "right" else (x - total / 2 if align == "center" else x)
        for i, sl in enumerate(slugs):
            self.icon(sl, x0 + i * (size + gap), y, size)

    def svg(self):
        body = "\n".join(self.els)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">\n'
            f'<rect x="0" y="0" width="{self.w}" height="{self.h}" fill="{BG}"/>\n{body}\n</svg>\n'
        )


# ---------------------------------------------------------------- Core
def core(lang):
    t = (lambda zh, en: zh) if lang == "zh" else (lambda zh, en: en)
    d = D(1600, 1000)
    d.header(
        t("AgenticX 产品与技术架构", "AgenticX Product & Technology Architecture"),
        t("统一多智能体框架与 Agent Runtime · Near Desktop 与 Enterprise 是其上的两种产品形态",
          "One multi-agent framework & Agent Runtime · Near Desktop and Enterprise are two product forms built on it"),
    )
    d.legend(990, 44, [
        ("box_impl", t("已落地", "Implemented")), ("box_ext", t("外部 / 可插拔", "External / Pluggable")),
        ("box_plan", t("规划中", "Planned")), ("main", t("默认主链路", "Default path")),
        ("thin", t("能力调用", "Capability call")), ("dash", t("演进关系", "Evolution relation")),
    ])

    # section label for entries
    d.text(40, 150, t("产品与开发入口", "Product & Developer"), 15, OR3, "bold")
    if lang == "en":
        d.text(40, 170, "Entry Points", 15, OR3, "bold")
    d.text(40, 196, t("并列产品面，互不包含", "Parallel product surfaces"), 12, DIM)

    # entry cards
    d.card(330, 104, 300, 118, t("Near Desktop｜本机优先", "Near Desktop | Local-first"),
           [R(["electron", "react"], "Electron + React"), t("多窗格 · 分身 · 群聊", "Multi-pane · Avatars · Group chat"), t("工作区 · 终端 · 自动化", "Workspace · Terminal · Automation")],
           variant="hub")
    d.card(650, 104, 300, 118, t("AgenticX Enterprise｜企业治理", "AgenticX Enterprise | Governance"),
           [R("nextdotjs", "Web Portal · Admin Console"), R("go", "Go AI Gateway"), t("在线主链路为独立 Go Gateway", "Online path: standalone Go Gateway")])
    d.card(970, 104, 300, 118, t("开发者入口", "Developer Entry Points"),
           [R("python", "Python SDK"), "agx CLI", "REST API + SSE"])

    # outer framework
    d.rect(300, 248, 1000, 542, fill="#120D0A", stroke=OR, sw=2.2, rx=20)
    _fw = t("AgenticX 核心框架", "AgenticX Core Framework")
    d.rect(850, 238, tw(_fw, 14) * 1.12 + 24, 22, fill=OR, stroke=None, rx=11)
    d.text(862, 254, _fw, 14, "#1C0F06", "bold")

    # Studio Runtime
    d.container(320, 286, 960, 102, None)
    d.add(f'<rect x="436" y="301" width="4" height="18" rx="2" fill="{OR}"/>')
    d.text(448, 316, "Studio Runtime", 16, CREAM, "bold")
    d.tag(448 + tw("Studio Runtime", 16) + 12, 300, t("已落地", "Implemented"))
    pills = [
        ("Studio Server", R("fastapi", "FastAPI · REST · SSE")),
        (t("会话与消息", "Sessions · Messages"), None),
        ("Meta-Agent", None),
        (t("团队与委派", "Teams · Delegation"), None),
        (t("分身与群聊", "Avatars · Groups"), None),
        (t("工作区与确认", "Workspace · Approval"), None),
    ]
    px0, pw, gap = 336, 142, 11.6
    d.add(f'<polyline points="{px0 + 20},{348} {px0 + 6 * pw + 5 * gap - 20},{348}" fill="none" stroke="{OR}" stroke-width="3"/>')
    for i, (a, sub) in enumerate(pills):
        d.pill(px0 + i * (pw + gap), 326, pw, 46, a, size=12.5, variant="hub" if i == 0 else "impl", sub=sub)

    # Studio <-> Agent Runtime
    d.wire([(776, 388), (776, 428)], "main")
    d.label(776 - 10 - tw(t("Python 调用", "Python calls"), 11.5) - 12, 408, t("Python 调用", "Python calls"), 11.5, OR3, bg="#120D0A", anchor="start")
    d.wire([(824, 428), (824, 388)], "main")
    d.label(834, 408, "RuntimeEvent", 11.5, OR3, bg="#120D0A", anchor="start")

    # Agent Runtime
    d.container(320, 428, 960, 262, t("Agent Runtime 与编排", "Agent Runtime & Orchestration"), t("已落地", "Implemented"), title_size=16)
    cw, cg = 304, 14
    row1 = [
        ("Agent Runtime", [t("Think–Act 循环 · 流式事件", "Think–Act loop · Streaming events"), t("上下文压缩", "Context compaction")], "hub"),
        (t("编排与协作", "Orchestration & Collaboration"), [t("Workflow · Flow · 条件与并行", "Workflow · Flow · Branch & parallel"), t("多智能体委派", "Multi-agent delegation")], "impl"),
        (t("可靠性与控制", "Reliability & Control"), [t("重试与故障转移 · 循环检测", "Retry & failover · Loop detection"), t("Token 预算 · Human-in-the-loop", "Token budget · Human-in-the-loop")], "impl"),
    ]
    row2 = [
        ("Tools · MCP", [R("modelcontextprotocol", t("内置工具 · MCP Hub", "Built-in tools · MCP Hub")), t("Computer Use · 沙箱执行", "Computer Use · Sandbox")]),
        ("Memory · Knowledge", [t("工作区记忆 · 会话检索", "Workspace memory · Session search"), t("知识库 RAG · GraphRAG", "Knowledge RAG · GraphRAG")]),
        ("LLM · Skills · Hooks", [t("多模型适配 · Skills 生命周期", "Multi-model · Skill lifecycle"), t("Hooks 事件扩展 · AGX Bundle", "Hooks · AGX Bundle")]),
    ]
    for i, (ti, ls, v) in enumerate(row1):
        d.card(336 + i * (cw + cg), 466, cw, 92, ti, ls, variant=v)
    # bus between rows
    bus_y = 572
    c0 = 336 + cw / 2
    d.add(f'<polyline points="{c0},558 {c0},{bus_y} {336 + 2 * (cw + cg) + cw / 2},{bus_y}" fill="none" stroke="{OR3}" stroke-width="1.8"/>')
    for i, (ti, ls) in enumerate(row2):
        cx = 336 + i * (cw + cg) + cw / 2
        d.wire([(cx, bus_y), (cx, 590)], "thin")
        if i:
            d.add(f'<circle cx="{cx}" cy="{bus_y}" r="3" fill="{OR3}"/>')
        d.card(336 + i * (cw + cg), 590, cw, 86, ti, ls)
    d.label(c0 + 150, bus_y, t("Agent Runtime 调用下层能力 ↓", "Agent Runtime calls capabilities ↓"), 11, OR3, bg=PANEL)

    # Core SDK
    d.container(320, 704, 940, 72, None)
    d.add(f'<rect x="336" y="731" width="4" height="18" rx="2" fill="{OR}"/>')
    d.text(348, 745, "Core SDK Runtime", 16, CREAM, "bold")
    d.tag(348 + tw("Core SDK Runtime", 16) + 10, 730, t("已落地", "Implemented"))
    sdk = ["Agent · Task · Tool", "ReActAgent", "AgentExecutor", "Task Validation", "A2A AgentCard"]
    sx, sw_, sg = 610, 120, 10
    for i, s in enumerate(sdk):
        d.pill(sx + i * (sw_ + sg), 718, sw_, 44, s, size=12)

    # entry wiring
    d.wire([(407, 222), (407, 326)], "main", end=True, start=True)
    d.label(462, 270, "HTTP / SSE", 12, OR3, bg="#120D0A")
    d.wire([(1100, 222), (1100, 286)], "thin")
    d.label(1100, 268, t("服务调用", "Service API"), 11.5, MUTED, bg="#120D0A")
    d.wire([(1270, 150), (1285, 150), (1285, 740), (1260, 740)], "thin")
    d.label(1300, 128, t("嵌入调用 · Python SDK", "Embedded API · Python SDK"), 11.5, MUTED, anchor="start")
    d.wire([(800, 222), (800, 248)], "dash")
    _ev = t("演进集成（非在线链路）", "Future integration (not an online path)")
    d.label(790 - tw(_ev, 11) - 12, 235, _ev, 11, DIM, anchor="start")

    # left: protocols
    d.container(40, 248, 220, 542, t("开放协议与交互", "Open Protocols"), None, variant="ext", title_size=15)
    d.text(56, 70 + 248 - 14, t("经协议接入点进入核心框架", "Enter via protocol port"), 11.5, DIM)
    protos = [("A2A", t("智能体互联", "Agent interoperability")), ("MCP", t("工具与资源", "Tools & resources")),
              ("AG-UI", t("流式交互", "Streaming interaction")), ("REST / SSE", "WebSocket")]
    ys = []
    for i, (a, b) in enumerate(protos):
        y = 324 + i * 114
        d.rect(56, y, 188, 100, fill="#17110C", stroke=OR3, sw=1, rx=12)
        d.line(150, y + 46, R("modelcontextprotocol", a) if a == "MCP" else a, 20, OR, "bold")
        d.text(150, y + 72, b, 12.5, MUTED, "normal", "middle")
        ys.append(y + 50)
    for y in ys:
        d.add(f'<polyline points="244,{y} 280,{y}" fill="none" stroke="{THIN}" stroke-width="1.5"/>')
    d.add(f'<polyline points="280,{ys[0]} 280,{ys[-1]}" fill="none" stroke="{THIN}" stroke-width="1.5"/>')
    d.wire([(280, 540), (300, 540)], "thin")
    d.add(f'<circle cx="300" cy="540" r="5" fill="{OR}" stroke="{BG}" stroke-width="2"/>')

    # right: ecosystem
    d.container(1330, 248, 230, 542, t("模型 · 工具 · 领域", "Models & Ecosystem"), None, variant="ext", title_size=15)
    groups = [
        (t("模型服务", "Model Services"), [t("云端兼容模型", "Cloud-compatible models"), t("本机模型", "Local models"), t("自定义 Provider", "Custom providers")]),
        (t("工具与数据生态", "Tool & Data Ecosystem"), [R("modelcontextprotocol", "MCP Server"), R("openapiinitiative", "OpenAPI"), t("文件与终端", "Files & terminal"), t("数据源连接器", "Data connectors")]),
        (t("领域扩展", "Domain Extensions"), ["GUI Agent", "Deep Research", t("代码智能体", "Coding agents"), "IM Gateway", "Claude Code Bridge"]),
    ]
    gy = 292
    mids = []
    for ti, ls in groups:
        h = 44 + len(ls) * 21
        d.rect(1346, gy, 198, h, fill="#17110C", stroke=OR3, sw=1, rx=12)
        d.text(1445, gy + 26, ti, 14, CREAM, "bold", "middle")
        for j, s in enumerate(ls):
            d.line(1445, gy + 48 + j * 21, s, 12.5, MUTED, "normal")
        mids.append(gy + h / 2)
        gy += h + 14
    for y in mids:
        d.add(f'<polyline points="1346,{y} 1316,{y}" fill="none" stroke="{THIN}" stroke-width="1.5"/>')
    d.add(f'<polyline points="1316,{mids[0]} 1316,{mids[-1]}" fill="none" stroke="{THIN}" stroke-width="1.5"/>')
    d.wire([(1316, 540), (1300, 540)], "thin")
    d.add(f'<circle cx="1300" cy="540" r="5" fill="{OR}" stroke="{BG}" stroke-width="2"/>')

    # bottom platform
    d.container(40, 822, 1210, 148, None)
    d.add(f'<rect x="58" y="848" width="4" height="18" rx="2" fill="{OR}"/>')
    d.text(70, 862, t("平台支撑层", "Platform"), 17, CREAM, "bold")
    if lang == "en":
        d.text(70, 884, "Foundation", 17, CREAM, "bold")
    d.tag(70, 900 if lang == "en" else 878, t("内置 / 可选", "Built-in / Optional"))
    gx, gw, gg = 212, 250, 12
    d.card(gx, 836, gw, 120, t("安全基础组件", "Safety Building Blocks"), [t("策略 · 护栏 · 权限", "Policy · Guardrails · Permissions"), t("审计 · 沙箱", "Audit · Sandbox")])
    d.card(gx + (gw + gg), 836, gw, 120, t("可观测性与评估", "Observability & Evaluation"), ["Trace · Metrics", R("opentelemetry", "OpenTelemetry"), "EvalSet · LLM Judge"])
    d.cyl(gx + 2 * (gw + gg), 832, gw, 128, t("存储", "Storage"),
          [R(["sqlite", "postgresql", "redis"], "SQLite · PostgreSQL · Redis"), R(["milvus", "qdrant"], "Chroma · Milvus · Qdrant"), R("neo4j", "Neo4j · Object Storage"), t("适配器成熟度不一", "Adapter maturity varies")], title_size=14, line_size=11)
    d.card(gx + 3 * (gw + gg), 836, gw, 120, t("运行与部署", "Runtime & Deployment"), [t("本机进程", "Local process"), R("docker", "Docker"), t("远程服务", "Remote service")])

    # planned
    d.container(1270, 822, 290, 148, t("演进能力", "Evolution"), t("规划中", "Planned"), variant="plan", title_size=15)
    for i, s in enumerate(["Agent Evolution", t("细粒度多租户 RBAC", "Fine-grained multi-tenant RBAC"), "Cluster Agent Runtime"]):
        d.rect(1288, 868 + i * 32, 254, 26, fill="#16130F", stroke=PLAN, sw=1, rx=8, dash="4 3")
        d.text(1415, 886 + i * 32, s, 12, MUTED, "normal", "middle")
    d.wire([(1285, 822), (1285, 790)], "dash")
    d.label(1296, 806, t("演进方向", "Evolution direction"), 11, DIM, anchor="start")
    return d


# ---------------------------------------------------------------- Desktop
def desktop(lang):
    t = (lambda zh, en: zh) if lang == "zh" else (lambda zh, en: en)
    d = D(1600, 1000)
    d.header(t("Near Desktop 架构", "Near Desktop Architecture"),
             t("本机优先的多智能体桌面工作台 · 默认链路全部在用户设备内完成",
               "Local-first multi-agent desktop workspace · the default path stays on the user device"))
    d.legend(990, 44, [
        ("box_impl", t("已落地", "Implemented")), ("box_ext", t("可选 · 已落地", "Optional · Implemented")),
        ("box_plan", t("规划中", "Planned")), ("main", t("默认主链路", "Default path")),
        ("thin", t("按需调用", "On-demand call")), ("dash", t("替代链路 / 未来演进", "Alternative / Future")),
    ])

    # device boundary
    d.container(120, 110, 1060, 880, None, variant="boundary")
    d.text(144, 972, t("用户设备｜macOS / Windows（Linux 为构建目标）", "User Device | macOS / Windows; Linux is a build target"), 13, DIM, "bold")

    # user
    d.person(62, 300)
    d.text(62, 336, t("用户", "User"), 14, CREAM, "bold", "middle")
    d.wire([(84, 300), (140, 300)], "main")
    d.label(62, 372, t(["对话 · 配置", "工作区操作"], ["Chat · Config", "Workspace"]), 11, MUTED)

    # Near Desktop panel
    d.container(140, 150, 320, 580, "Near Desktop", t("已落地", "Implemented"))
    d.card(160, 196, 280, 96, R("react", t("React 多窗格界面", "React Multi-pane UI")),
           [t("对话 · 分身 · 群聊", "Chat · Avatars · Group chat"), t("设置 · 历史 · 工作区", "Settings · History · Workspace")])
    d.card(250, 312, 190, 84, t("Zustand 状态", "Zustand State"),
           [t("窗格 · 消息 · 模型", "Panes · Messages · Models"), t("流式状态 · Token", "Streaming · Tokens")], line_size=11.5)
    d.card(160, 416, 280, 132, R("electron", t("Electron 主进程", "Electron Main Process")),
           [t("窗口与进程", "Windows & processes"), t("IPC 与系统集成", "IPC & OS integration"), t("自动化与 Sidecar", "Automation & sidecars")], variant="hub")
    d.wire([(205, 292), (205, 416)], "thin", end=True, start=True)
    d.label(205, 354, "Preload IPC", 11, OR3, bg=PANEL)
    # extension band
    d.text(160, 580, t("扩展体验 · 已落地", "Extended Experiences · Implemented"), 12.5, OR3, "bold")
    chips = ["Voice Focus", "Automation", "Claude Code Bridge", "Code Index", "Data Sources"]
    cx, cy = 160, 594
    for s in chips:
        w = tw(s, 12) + 22
        if cx + w > 440:
            cx, cy = 160, cy + 36
        d.rect(cx, cy, w, 26, fill="#1A130E", stroke="#5A3B24", sw=1, rx=13)
        d.text(cx + w / 2, cy + 17.5, s, 12, CREAM, "normal", "middle")
        cx += w + 8

    # Runtime core
    d.container(560, 150, 580, 296, t("本机 Agent Runtime", "Local Agent Runtime"), t("默认 · 已落地", "Default · Implemented"))
    d.card(580, 194, 540, 66, "agx serve / agx-server", [], variant="hub", title_size=18,
           sub=R(["python", "fastapi"], t("Python Studio + Agent Runtime｜REST API + SSE", "Python Studio + Agent Runtime | REST API + SSE")))
    tiles = [
        [t("会话与消息", "Sessions & Messages"), t("Meta-Agent · 委派", "Meta-Agent · Delegation"), t("分身 · 群聊", "Avatars · Group Chat"), t("流式事件 · 确认", "Streaming · Approval")],
        ["Tools · MCP", "Skills · Hooks", t("记忆 · 会话检索", "Memory · Session Search"), t("知识库 · LLM 路由", "Knowledge · LLM Routing")],
    ]
    tw_, tg = 126, 12
    for r, row in enumerate(tiles):
        for c, s in enumerate(row):
            lines = [s] if tw(s, 12.5) < tw_ - 12 else [p.strip() for p in s.split("·")]
            if len(lines) == 2 and lang == "en":
                lines = [lines[0], "· " + lines[1]]
            d.pill(580 + c * (tw_ + tg), 276 + r * 80, tw_, 66, lines, size=12.5)

    # Electron <-> agx serve
    d.wire([(440, 440), (510, 440), (510, 227), (580, 227)], "main", end=True, start=True)
    d.label(510, 300, t(["HTTP 请求", "⇅", "SSE 流式事件"], ["HTTP", "requests", "⇅ SSE", "events"]), 11, OR3, bg="#0F0C0A")
    d.label(510, 392, t(["127.0.0.1", "默认本地"], ["127.0.0.1", "default"]), 10.5, MUTED, bg="#0F0C0A")

    # execution plane
    d.container(560, 472, 580, 140, None)
    d.text(1124, 496, t("本机执行面 · 已落地", "Local Execution Plane · Implemented"), 13, OR3, "bold", "end")
    d.card(576, 508, 266, 90, t("Desktop 原生执行", "Desktop Native Execution"),
           [R("nodedotjs", t("内嵌终端 · node-pty", "Embedded terminal · node-pty")), t("Computer Use · 原生连接器", "Computer Use · Native connectors")], line_size=12)
    d.card(858, 508, 266, 90, t("Runtime 工具执行", "Runtime Tool Execution"),
           [t("文件 · Bash · LiteParse", "Files · Bash · LiteParse"), "MCP stdio · Knowledge Search"], line_size=12)
    d.wire([(440, 530), (576, 530)], "thin")
    d.label(508, 552, t(["IPC /", "系统能力"], ["IPC /", "OS capability"]), 10.5, MUTED, bg="#0F0C0A")
    d.wire([(991, 446), (991, 508)], "main")
    d.label(1060, 462, t("工具调用 / 执行结果", "Tool call / Result"), 11, OR3, bg="#0F0C0A")

    # data plane
    d.container(140, 790, 1020, 160, None)
    d.add(f'<rect x="158" y="826" width="4" height="18" rx="2" fill="{OR}"/>')
    d.text(170, 840, t("本地数据面", "Local Data"), 16, CREAM, "bold")
    if lang == "en":
        d.text(170, 860, "Plane", 16, CREAM, "bold")
    d.tag(170, 870 if lang == "en" else 852, t("已落地", "Implemented"))
    nx, nw, ng = 290, 200, 20
    d.cyl(nx, 812, nw, 126, t("本地配置", "Local Configuration"), [R("yaml", "~/.agenticx/config.yaml")], title_size=14, line_size=11.5)
    d.file_node(nx + (nw + ng), 812, nw, 126, t("运行数据", "Runtime Data"), ["workspace · logs · layout"], title_size=14, line_size=11.5)
    d.cyl(nx + 2 * (nw + ng), 812, nw, 126, t("会话与角色", "Sessions & Roles"), ["sessions · avatars · groups"], title_size=14, line_size=11.5)
    d.cyl(nx + 3 * (nw + ng), 812, nw, 126, t("记忆与知识库", "Memory & Knowledge"), [R("sqlite", "SQLite · Chroma"), t("graph（可选）", "graph (optional)")], title_size=14, line_size=11.5)
    centers = [nx + nw / 2 + i * (nw + ng) for i in range(4)]
    bus = 764
    d.wire([(1140, 400), (1160, 400), (1160, 643)], "thin", end=False)
    d.wire([(1160, 657), (1160, bus)], "thin", end=False)
    d.add(f'<polyline points="{centers[0] + 40},{bus} 1160,{bus}" fill="none" stroke="{THIN}" stroke-width="1.5"/>')
    for i, c in enumerate(centers):
        x = c + 40 if i == 0 else c
        d.wire([(x, bus), (x, 812)], "thin")
    d.label(1060, bus, t("本地读写", "Local read / write"), 11, MUTED, bg="#0F0C0A")
    # Near -> config & runtime data
    d.wire([(250, 730), (250, 776), (centers[0] - 30, 776), (centers[0] - 30, 812)], "thin")
    d.wire([(380, 730), (380, 748), (centers[1] - 40, 748), (centers[1] - 40, 758)], "thin", end=False)
    d.wire([(centers[1] - 40, 770), (centers[1] - 40, 812)], "thin")
    d.label(300, 752, t("设置与布局持久化", "Settings & layout"), 10.5, MUTED, bg="#0F0C0A")

    # external
    d.container(1210, 150, 360, 300, t("外部能力", "External Capabilities"), t("按需调用", "On-demand"), variant="ext", title_size=15)
    d.rect(1230, 194, 320, 40, fill="#17110C", stroke=OR3, sw=1, rx=10)
    d.line(1390, 219, R("wechat", t("飞书 / 微信等外部渠道", "Feishu / WeChat Channels")), 13, CREAM, "bold")
    d.cloud(1262, 240, 256, 78)
    d.text(1390, 302, t("兼容模型服务", "Compatible Model Services"), 13, CREAM, "bold", "middle")
    d.rect(1230, 326, 320, 40, fill="#17110C", stroke=OR3, sw=1, rx=10)
    d.line(1390, 351, R("modelcontextprotocol", t("远程 MCP Server", "Remote MCP Server")), 13, CREAM, "bold")
    d.rect(1230, 380, 320, 40, fill="#17110C", stroke=OR3, sw=1, rx=10)
    d.text(1390, 405, t("Skill / Bundle 注册表", "Skill / Bundle Registry"), 13, CREAM, "bold", "middle")
    d.wire([(1140, 292), (1262, 292)], "thin", end=True, start=True)
    d.label(1188, 274, t("模型请求 / 流式", "Model req / stream"), 10.5, MUTED, bg=BG)
    d.wire([(1140, 346), (1230, 346)], "thin")
    d.label(1188, 334, t("MCP 协议", "MCP protocol"), 10.5, MUTED, bg=BG)
    d.wire([(1140, 400), (1230, 400)], "thin")
    d.label(1188, 388, t("搜索 / 安装", "Search / Install"), 10.5, MUTED, bg=BG)
    d.wire([(420, 150), (420, 130), (1195, 130), (1195, 214), (1230, 214)], "thin")
    d.label(820, 130, t("本地模式自动拉起 Sidecar / 消息同步", "Local mode starts sidecars / Message sync"), 11, MUTED, bg=BG)

    # remote
    d.container(1210, 490, 360, 190, t("远程后端", "Remote Backend"), t("可选 · 已落地", "Optional · Implemented"), variant="ext", title_size=15)
    for i, s in enumerate([R("python", t("远程 agx serve", "Remote agx serve")), t("单一 Server URL", "Single Server URL"), t("Token 鉴权", "Token authentication")]):
        d.pill(1230, 534 + i * 46, 320, 36, s, size=13, variant="ext")
    d.wire([(460, 650), (1210, 650)], "dash_or")
    d.label(836, 650, t("remote_server｜替代本机后端（二选一）", "remote_server | Replaces local backend (either-or)"), 11, MUTED, bg="#0F0C0A")

    # cluster
    d.container(1210, 730, 360, 200, "Cluster / HA", t("规划中", "Planned"), variant="plan", title_size=15)
    for i, s in enumerate([t("统一入口", "Unified endpoint"), R("kubernetes", t("多副本 Agent Runtime", "Multi-replica Agent Runtime")), t("共享会话与运行资源", "Shared session & runtime resources")]):
        d.rect(1230, 776 + i * 46, 320, 36, fill="#16130F", stroke=PLAN, sw=1, rx=10, dash="4 3")
        d.line(1390, 799 + i * 46, s, 12.5, MUTED, "normal")
    d.wire([(1390, 680), (1390, 730)], "dash")
    d.label(1460, 705, t("未来演进", "Future evolution"), 11, DIM, bg=BG)
    return d


# ---------------------------------------------------------------- Enterprise
def enterprise(lang):
    t = (lambda zh, en: zh) if lang == "zh" else (lambda zh, en: en)
    d = D(1600, 1040)
    d.header(t("AgenticX Enterprise 架构", "AgenticX Enterprise Architecture"),
             t("企业私有化部署 · 控制面治理配置 · Go AI Gateway 承载在线请求主链路",
               "Private deployment · control plane governs config · Go AI Gateway carries the online request path"))
    d.legend(990, 44, [
        ("box_impl", t("已落地", "Implemented")), ("box_ext", t("外部 / 可选", "External / Optional")),
        ("box_plan", t("MVP · 非默认", "MVP · Non-default")), ("main", t("在线请求主链路", "Online request path")),
        ("thin", t("控制与数据读写", "Control & data access")), ("dash", t("可选 / 演进关系", "Optional / Evolution")),
    ])

    d.container(30, 110, 1160, 866, None, variant="boundary")
    d.text(50, 962, t("企业私有化部署域｜当前可运行系统", "Enterprise Private Deployment Domain | Current Runnable System"), 13, DIM, "bold")

    # access layer
    d.container(50, 128, 1120, 110, t("企业访问层", "Enterprise Access Layer"), t("已落地", "Implemented"), title_size=15)
    # admin
    d.person(80, 196)
    d.text(100, 201, t("平台管理员", "Platform Admin"), 13, CREAM, "normal")
    d.wire([(100 + tw(t("平台管理员", "Platform Admin"), 13) + 8, 196), (230, 196)], "thin")
    d.pill(230, 176, 170, 40, R("nextdotjs", "Admin Console"), size=13, variant="hub")
    # employee
    d.person(520, 196)
    d.text(540, 201, t("企业员工", "Employee"), 13, CREAM, "normal")
    d.wire([(540 + tw(t("企业员工", "Employee"), 13) + 8, 196), (640, 196)], "main")
    d.pill(640, 176, 150, 40, R("nextdotjs", "Web Portal"), size=13, variant="hub")
    # api client
    d.app_icon(860, 196)
    d.text(882, 192, t("企业应用 /", "Enterprise App /"), 12, CREAM)
    d.text(882, 208, t("API 客户端", "API Client"), 12, CREAM)
    d.wire([(882 + tw(t("企业应用 /", "Enterprise App /"), 12) + 8, 196), (1008, 196)], "main")
    d.pill(1008, 176, 158, 40, R("go", "Go AI Gateway"), size=13, variant="hub")

    # control plane
    d.container(50, 270, 380, 430, t("企业控制面", "Enterprise Control Plane"), t("已落地", "Implemented"), title_size=15)
    d.card(70, 314, 340, 50, "Admin Console", [], variant="hub", title_size=16)
    cw, cg = 106, 11
    cards = [
        [t(["身份与权限"], ["Identity", "& Access"]), t(["审计查询"], ["Audit", "Search"]), t(["合规与运维"], ["Compliance", "& Ops"])],
        [t(["模型与通道"], ["Models &", "Channels"]), t(["策略规则"], ["Policy", "Rules"]), t(["Token 与配额"], ["Tokens &", "Quotas"])],
    ]
    for r, row in enumerate(cards):
        for c, s in enumerate(row):
            d.pill(70 + c * (cw + cg), 384 + r * 76, cw, 62, s, size=12.5, variant="impl")
    d.text(240, 684, t("治理与配置 · 不承载模型推理或完整 Agent 执行", "Governance & config · no inference or full agent execution"), 11, DIM, "normal", "middle")
    # config snapshot bus (row 2)
    by = 612
    for c in range(3):
        x = 70 + c * (cw + cg) + cw / 2
        d.add(f'<polyline points="{x},{384 + 76 + 62} {x},{by}" fill="none" stroke="{OR3}" stroke-width="1.5"/>')
        d.add(f'<circle cx="{x}" cy="{by}" r="3" fill="{OR3}"/>')
    d.wire([(70 + cw / 2, by), (490, by)], "thin")
    d.label(260, 636, t("配置快照 / 热加载 → Gateway", "Config snapshot / Hot reload → Gateway"), 11, OR3, bg=PANEL)
    d.wire([(315, 216), (315, 314)], "thin")

    # portal
    d.container(490, 270, 590, 110, "Web Portal · Portal BFF", t("已落地", "Implemented"), title_size=15)
    d.text(1066, 296, "POST /api/chat/completions", 11.5, OR3, "normal", "end")
    pn = [t("聊天工作区", "Chat Workspace"), t("会话与历史", "Sessions & History"), t("可见模型校验", "Model Visibility"), "Portal BFF"]
    pxs = [640, 780, 890, 980]
    pws = [150, 96, 96, 90]
    pxs = [510, 660, 810, 960]
    pws = [140, 140, 140, 104]
    d.add(f'<polyline points="{510 + 70},{342} {960 + 52},{342}" fill="none" stroke="{OR}" stroke-width="3"/>')
    for i, s in enumerate(pn):
        d.pill(pxs[i], 318, pws[i], 48, s, size=12.5, variant="hub" if i in (0, 3) else "impl")
    d.wire([(715, 216), (715, 256), (580, 256), (580, 318)], "main")

    # gateway
    d.container(490, 410, 680, 290, "Go AI Gateway", t("在线主链路 · 已落地", "Online Path · Implemented"), title_size=16, icons=("go",))
    gw_, gg = 196, 30
    nodes = [
        (t("鉴权与主体", "Auth & Identity"), "JWT / PAT · Tenant / Dept / User"),
        (t("配额与限流", "Quota & Rate Limits"), "TPM / RPM · Budget"),
        (t("缓存与请求策略", "Cache & Request Policy"), t("精确 / 语义缓存 · Policy", "Exact / Semantic cache · Policy")),
        (t("模型与通道路由", "Model & Channel Routing"), "Channel · KeyPool · Relay"),
        (t("响应策略", "Response Policy"), t("流式检查 · 脱敏", "Stream inspection · Redaction")),
        (t("审计与用量", "Audit & Usage"), "Audit Chain · Token Usage"),
    ]
    pos = [(0, 0), (1, 0), (2, 0), (2, 1), (1, 1), (0, 1)]
    x0, y0, nh, rg = 510, 452, 62, 26
    coords = []
    for (c, r) in pos:
        coords.append((x0 + c * (gw_ + gg), y0 + r * (nh + rg)))
    # snake main line behind nodes
    pts = [(coords[0][0] + gw_ / 2, coords[0][1] + nh / 2), (coords[2][0] + gw_ / 2, coords[2][1] + nh / 2),
           (coords[3][0] + gw_ / 2, coords[3][1] + nh / 2), (coords[5][0] + gw_ / 2, coords[5][1] + nh / 2)]
    d.add('<polyline points="' + " ".join(f"{a},{b}" for a, b in pts) + f'" fill="none" stroke="{OR}" stroke-width="4" stroke-linejoin="round"/>')
    for i, ((cx_, cy_), (ti, sub)) in enumerate(zip(coords, nodes)):
        d.pill(cx_, cy_, gw_, nh, "①②③④⑤⑥"[i] + " " + ti, size=13, variant="hub" if i in (0, 3) else "impl", sub=sub, bold=True)
    # capability band
    caps = [t("跨境合规", "Cross-border Compliance"), "Wasm Hooks", "MCP Host / Proxy", t("故障转移", "Failover")]
    bx = 510
    for s in caps:
        w = tw(s, 12) + 22
        d.rect(bx, 632, w, 26, fill="#1A130E", stroke="#5A3B24", sw=1, rx=13)
        d.text(bx + w / 2, 649.5, s, 12, CREAM, "normal", "middle")
        bx += w + 10
    d.text(830, 686, t("当前职责：企业合规网关与模型请求中继，不等同于完整 Agent Runtime",
                       "Current role: compliance gateway & model relay — not a full Agent Runtime"), 12, OR3, "bold", "middle")

    # BFF <-> gateway
    d.wire([(1012, 366), (1012, 452)], "main", end=True, start=True)
    d.label(904, 396, t(["JWT + Provider Context", "⇅ 普通 / 流式响应"], ["JWT + Provider Context", "⇅ Standard / Stream"]), 10.5, OR3, bg="#0F0C0A")
    # api client -> gateway
    d.wire([(1125, 216), (1125, 452)], "main", end=True, start=True)
    d.label(1125, 256, t(["JWT / PAT", "直连"], ["JWT / PAT", "direct"]), 10.5, OR3, bg="#0F0C0A")

    # upstream models
    d.cloud(1226, 450, 350, 220)
    d.text(1400, 566, t("上游兼容模型服务", "Upstream Model Services"), 15, CREAM, "bold", "middle")
    d.tag(1400 - tw(t("外部能力", "External"), 11) / 2 - 9, 576, t("外部能力", "External"), "ext")
    for i, s in enumerate([t("OpenAI 兼容接口", "OpenAI-compatible API"), t("企业专属模型服务", "Enterprise-dedicated models"), t("其他兼容提供方", "Other compatible providers")]):
        d.text(1400, 616 + i * 20, s, 12.5, MUTED, "normal", "middle")
    d.wire([(1154, 575), (1262, 575)], "main")
    d.wire([(1262, 615), (1154, 615)], "thin")
    d.label(1208, 558, t("模型请求", "Model request"), 10.5, OR3, bg=BG)
    d.label(1208, 632, t("普通 / 流式响应", "Std / stream"), 10.5, MUTED, bg=BG)

    # evolution
    d.container(1220, 716, 350, 268, t("Agent Runtime 演进区", "Agent Runtime Evolution"), None, variant="plan", title_size=15)
    d.card(1238, 762, 314, 116, t("Enterprise Edge Agent｜MVP", "Enterprise Edge Agent | MVP"),
           [R("go", t("Go Sidecar · 任务沙箱与 Trace", "Go sidecar · Task sandbox & trace")), t("经 Gateway 调用模型", "Models via Gateway"), t("已存在 · 未进默认链路", "Exists · Not on default path")],
           variant="plan", title_size=14, line_size=12)
    d.card(1238, 890, 314, 80, t("Cluster Agent Runtime｜未来", "Cluster Agent Runtime | Future"),
           [R("kubernetes", t("K8s 多副本 · 统一调度 · 未开始", "K8s replicas · Scheduling · Not started"))], variant="future", title_size=14, line_size=12)
    d.wire([(1170, 668), (1200, 668), (1200, 820), (1238, 820)], "dash", end=True, start=True)
    d.label(1300, 700, t("可选任务路由 / 模型中继", "Optional task routing / relay"), 10.5, DIM, bg=BG)

    # data infra
    d.container(50, 780, 1120, 150, None)
    d.cyl(70, 792, 470, 128, R(["postgresql", "mysql"], "PostgreSQL（默认）/ MySQL（可选）" if lang == "zh" else "PostgreSQL (default) / MySQL (optional)"),
          [t("身份与权限 · 会话与历史 · 运行时配置", "Identity · Sessions & history · Runtime config"), t("Token 用量 · 策略与审计索引", "Token usage · Policy & audit index")], title_size=14, line_size=12)
    d.cyl(570, 792, 290, 128, R("redis", t("Redis｜可选", "Redis | Optional")),
          [t("精确 / 语义缓存", "Exact / semantic cache"), t("分布式 TPM / RPM 限流", "Distributed TPM / RPM"), t("未配置时内存降级", "Falls back to memory")], title_size=14, line_size=12)
    d.file_node(890, 796, 262, 122, t("追加式审计日志", "Append-only Audit Log"),
                [R("json", t("JSONL 哈希链", "JSONL hash chain")), t("必须成功的本地兜底", "Must-succeed local fallback")], title_size=14, line_size=12)
    _inf = t("企业数据基础设施 · 已落地", "Data Infrastructure · Implemented")
    d.rect(1005 - tw(_inf, 12) - 24, 770, tw(_inf, 12) + 24, 22, fill=OR, stroke=None, rx=11)
    d.text(1005 - 12, 785, _inf, 12, "#1C0F06", "bold", "end")
    # control -> PG
    d.wire([(150, 700), (150, 792)], "thin", end=True, start=True)
    d.label(150, 740, t(["治理配置", "读写"], ["Governance", "config"]), 10.5, MUTED, bg="#0F0C0A")
    # BFF -> PG (hop over config bus)
    d.wire([(490, 360), (460, 360), (460, by - 7)], "thin", end=False)
    d.wire([(460, by + 7), (460, 800)], "thin", end=True)
    d.add(f'<polyline points="460,360 490,360" fill="none" stroke="{THIN}" stroke-width="1.5"/>')
    d.label(380, 740, t(["会话归属 /", "消息持久化"], ["Session owner /", "Message persist"]), 10.5, MUTED, bg="#0F0C0A")
    # gateway -> PG / Redis / audit
    d.wire([(520, 700), (520, 800)], "thin")
    d.label(520, 740, t(["用量与", "审计索引"], ["Usage &", "audit index"]), 10.5, MUTED, bg="#0F0C0A")
    d.wire([(715, 700), (715, 792)], "thin", end=True, start=True)
    d.label(715, 740, t("缓存 / 限流", "Cache / Rate limit"), 10.5, MUTED, bg="#0F0C0A")
    d.wire([(1020, 700), (1020, 796)], "thin")
    d.label(1020, 740, t("追加式审计兜底", "Append-only fallback"), 10.5, MUTED, bg="#0F0C0A")
    # control -> cluster (future)
    d.wire([(50, 660), (40, 660), (40, 1000), (1400, 1000), (1400, 970)], "dash")
    d.label(720, 1000, t("未来治理与调度", "Future governance & scheduling"), 10.5, DIM, bg=BG)
    return d


BUILDERS = {"core": core, "desktop": desktop, "enterprise": enterprise}

if __name__ == "__main__":
    out = sys.argv[1]
    for name, fn in BUILDERS.items():
        for lang in ("zh", "en"):
            p = os.path.join(out, f"{name}-{lang}")
            os.makedirs(p, exist_ok=True)
            with open(os.path.join(p, "diagram.svg"), "w") as f:
                f.write(fn(lang).svg())
    print("ok")
