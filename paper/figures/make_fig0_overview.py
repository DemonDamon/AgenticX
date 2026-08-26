#!/usr/bin/env python
"""Figure 0: TeamBench 总览框架图(pipeline 示意图,matplotlib 绘制)"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

FIGDIR = os.path.dirname(os.path.abspath(__file__))
C_TASK = "#4C72B0"; C_SINGLE = "#DD8452"; C_TEAM = "#55A868"; C_SCORE = "#C44E52"; C_METRIC = "#8172B3"
plt.rcParams.update({"font.size": 8.5, "figure.dpi": 300, "savefig.bbox": "tight"})

def box(ax, x, y, w, h, text, color, fs=8.0, tc="white", bold=False, r=0.02):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0.004,rounding_size={r}",
                                fc=color, ec="none", zorder=2, alpha=0.92))
    ax.text(x + w/2, y + h/2, text, ha="center", va="center", fontsize=fs,
            color=tc, zorder=3, fontweight="bold" if bold else "normal", linespacing=1.35)

def arrow(ax, x1, y1, x2, y2, color="#666", lw=1.3, style="-|>", rad=0.0):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style, mutation_scale=10,
                                 color=color, lw=lw, zorder=1,
                                 connectionstyle=f"arc3,rad={rad}"))

fig, ax = plt.subplots(figsize=(7.4, 3.5))
ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.axis("off")

# ---- 标题 ----
ax.text(0.5, 0.97, "TeamBench: paired individual-vs-team evaluation", ha="center",
        fontsize=10.5, fontweight="bold")

# ---- 左:任务层 ----
box(ax, 0.02, 0.42, 0.17, 0.44,
    "15 parametrized\noffice tasks\n\n5 scenarios\n× 3 coupling\n  levels\n\n(role cards,\n workspace,\n verify spec)",
    C_TASK, fs=7.6)
ax.text(0.105, 0.35, "Task suite", ha="center", fontsize=8.5, fontweight="bold", color=C_TASK)

# ---- 中上:双模式 ----
box(ax, 0.26, 0.68, 0.19, 0.18, "Single-agent mode\none agent,\nfull task", C_SINGLE, fs=7.8)
box(ax, 0.26, 0.38, 0.19, 0.18, "Team mode\nk role-specialized\nagents + workflow", C_TEAM, fs=7.8)
ax.text(0.355, 0.30, "Paired modes\n(same task, same budget)", ha="center",
        fontsize=8.2, fontweight="bold", color="#333")
arrow(ax, 0.19, 0.75, 0.26, 0.77, C_TASK)
arrow(ax, 0.19, 0.50, 0.26, 0.47, C_TASK)

# ---- 中右:artifact ----
box(ax, 0.50, 0.68, 0.135, 0.18, "artifact\n$a_s$", "#999", fs=8.5, tc="white", bold=True)
box(ax, 0.50, 0.38, 0.135, 0.18, "artifact\n$a_t$", "#999", fs=8.5, tc="white", bold=True)
arrow(ax, 0.45, 0.77, 0.50, 0.77, C_SINGLE)
arrow(ax, 0.45, 0.47, 0.50, 0.47, C_TEAM)

# ---- 右:三层 scoring ----
box(ax, 0.68, 0.62, 0.30, 0.24,
    "Artifact scoring (identical for both modes)\n"
    "L1 structural 50%  ·  L2 numeric 30%\n"
    "L3 cross-vendor LLM judge 20%", C_SCORE, fs=7.4)
arrow(ax, 0.635, 0.77, 0.68, 0.74, "#999")
arrow(ax, 0.635, 0.47, 0.68, 0.64, "#999")

# ---- 右下:团队级指标 ----
box(ax, 0.68, 0.28, 0.30, 0.26,
    "Team-level metrics\n"
    "CTR = Q(a_t)/Q(a_s)\n"
    "CO  = tokens(t)/tokens(s)\n"
    "PC  ·  TMS", C_METRIC, fs=7.4)
arrow(ax, 0.83, 0.62, 0.83, 0.54, C_SCORE, style="<|-|>")

# ---- 底部:发现带 ----
box(ax, 0.02, 0.05, 0.96, 0.14,
    "Findings:  teams lose 4–7% capability (CTR 0.93–0.96, p<1e-5)   ·   2.4–3.4× coordination tax   ·   "
    "stronger models collaborate worse   ·   only aggregation-dominant scenarios break even",
    "#333", fs=7.0, tc="white")

fig.savefig(os.path.join(FIGDIR, "fig0_overview.pdf"))
fig.savefig(os.path.join(FIGDIR, "fig0_overview.png"))
print("saved:", os.path.join(FIGDIR, "fig0_overview.png"))
