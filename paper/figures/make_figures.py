#!/usr/bin/env python
"""TeamBench 论文出图脚本:从 5 模型 summary.jsonl 计算指标并生成出版级图表。
输出: paper/figures/*.pdf (矢量) + *.png (300dpi)
"""
import json, os, glob, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # paper/
FIGDIR = os.path.join(ROOT, "figures")
os.makedirs(FIGDIR, exist_ok=True)

# ---------- 模型定义(家族顺序) ----------
MODELS = [
    # (显示名, exp_key, 家族, 档位, 颜色, marker)
    ("DS-V4-Flash", "dsv4flash_v3", "DeepSeek", "mid",     "#4C72B0", "o"),
    ("DS-V4-Pro",   "dsv4pro_v3",   "DeepSeek", "flagship","#2E5A99", "s"),
    ("Kimi-K2.6",   "kimi_k26",     "Kimi",     "mid",     "#DD8452", "o"),
    ("Kimi-K3",     "kimi_k3",      "Kimi",     "flagship","#B45A2A", "s"),
    ("GLM-5.3",     "glm53",        "Zhipu",    "flagship","#55A868", "D"),
]

EXP_PATHS = {
    "dsv4flash_v3": ["paper/experiments/baseline_v0.2b_dsv4flash_v3prompt/summary.jsonl"],
    "dsv4pro_v3":   ["paper/experiments/baseline_v0.3_pro/summary.jsonl"],
    "kimi_k26":     ["paper/experiments/baseline_v0.5_kimi_k26/summary.jsonl",
                     "paper/experiments/baseline_v0.5_kimi_k26_fix/summary.jsonl"],
    "kimi_k3":      ["paper/experiments/baseline_v0.4_kimi_k3/summary.jsonl"],
    "glm53":        ["paper/experiments/baseline_v0.6_glm53/summary.jsonl",
                     "paper/experiments/baseline_v0.6_glm53_fix/summary.jsonl"],
}

COUPLINGS = [("L", "Low"), ("M", "Medium"), ("H", "High")]
SCENARIOS = ["PROJ", "DOC", "DATA", "CONTENT", "CROSS"]
SCEN_LABEL = {"PROJ": "Project\ntracking", "DOC": "Document\ncollab.", "DATA": "Data\nanalysis",
              "CONTENT": "Content\nproduction", "CROSS": "Cross-dept\ncomm."}

plt.rcParams.update({
    "font.size": 9, "axes.labelsize": 10, "axes.titlesize": 10,
    "xtick.labelsize": 8.5, "ytick.labelsize": 8.5, "legend.fontsize": 8,
    "axes.spines.top": False, "axes.spines.right": False,
    "figure.dpi": 300, "savefig.bbox": "tight",
})

def load_pairs():
    """返回 {exp_key: {(task,seed): {'single':run,'team':run}}}"""
    out = {}
    for key, paths in EXP_PATHS.items():
        runs = {}
        for p in paths:
            fp = os.path.join(ROOT, os.pardir, p) if not os.path.isabs(p) else p
            fp = os.path.normpath(fp)
            if not os.path.exists(fp):
                continue
            with open(fp) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    r = json.loads(line)
                    if r.get("error"):
                        continue
                    runs[(r["task_id"], r["mode"], r["seed"])] = r
        pairs = {}
        for (tid, mode, seed), r in runs.items():
            pairs.setdefault((tid, seed), {})[mode] = r
        out[key] = {k: v for k, v in pairs.items() if "single" in v and "team" in v}
    return out

def ctr_of(d):
    qs, qt = d["single"]["Q"], d["team"]["Q"]
    return qt / qs if qs > 0 else 0.0

def stats(pairs):
    by_c = defaultdict(list); by_o = defaultdict(list); tok = []; ctrs = []
    for (tid, seed), d in pairs.items():
        c = ctr_of(d)
        by_c[tid.split("-")[2][0]].append(c)
        by_o[tid.split("-")[1]].append(c)
        ts, tt = d["single"]["total_tokens"], d["team"]["total_tokens"]
        if ts > 0:
            tok.append(tt / ts)
        ctrs.append(c)
    return by_c, by_o, ctrs, tok

def main():
    pairs_all = load_pairs()
    for name, key, *_ in MODELS:
        n = len(pairs_all.get(key, {}))
        print(f"[load] {name}: {n} pairs")
        if n == 0:
            print(f"  WARNING: no data for {name}")

    stats_all = {key: stats(pairs_all[key]) for _, key, *_ in MODELS if key in pairs_all}

    # ============ Figure 1: CTR vs coupling (5 models) ============
    fig, ax = plt.subplots(figsize=(4.2, 3.0))
    x = np.arange(3)
    for name, key, fam, tier, color, marker in MODELS:
        if key not in stats_all: continue
        by_c = stats_all[key][0]
        means = [np.mean(by_c[c]) for c, _ in COUPLINGS]
        sems = [np.std(by_c[c]) / np.sqrt(len(by_c[c])) for c, _ in COUPLINGS]
        ax.errorbar(x, means, yerr=sems, color=color, marker=marker, ms=5,
                    lw=1.6, capsize=2.5, label=f"{name} ({fam})")
    ax.axhline(1.0, color="gray", ls="--", lw=0.9, zorder=0)
    ax.text(2.42, 1.003, "break-even", fontsize=7.5, color="gray", va="bottom", ha="right")
    ax.axhspan(0.95, 1.05, color="gray", alpha=0.07, zorder=0)
    ax.set_xticks(x); ax.set_xticklabels([l for _, l in COUPLINGS])
    ax.set_xlabel("Task coupling level")
    ax.set_ylabel("Capability Transfer Rate (CTR)")
    ax.set_ylim(0.82, 1.06)
    ax.legend(loc="lower right", frameon=False, handlelength=1.6, labelspacing=0.25)
    fig.savefig(os.path.join(FIGDIR, "fig1_ctr_coupling.pdf"))
    fig.savefig(os.path.join(FIGDIR, "fig1_ctr_coupling.png"))
    plt.close(fig)

    # ============ Figure 2: capability-transfer paradox ============
    fig, axes = plt.subplots(1, 2, figsize=(7.0, 2.9))
    names = [m[0] for m in MODELS if m[1] in stats_all]
    ctr_overall = [np.mean(stats_all[k][2]) for _, k, *_ in MODELS if k in stats_all]
    co_overall = [np.mean(stats_all[k][3]) for _, k, *_ in MODELS if k in stats_all]
    colors = [m[4] for m in MODELS if m[1] in stats_all]
    xs = np.arange(len(names))

    ax = axes[0]
    bars = ax.bar(xs, ctr_overall, color=colors, width=0.62)
    ax.axhline(1.0, color="gray", ls="--", lw=0.9)
    ax.set_ylim(0.90, 1.00)
    ax.set_ylabel("Overall CTR")
    ax.set_title("(a) Team capability transfer", fontsize=9.5)
    ax.set_xticks(xs); ax.set_xticklabels(names, rotation=28, ha="right", fontsize=7.5)
    for b, v in zip(bars, ctr_overall):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.0015, f"{v:.3f}",
                ha="center", fontsize=7, color="#333")

    ax = axes[1]
    bars = ax.bar(xs, co_overall, color=colors, width=0.62)
    ax.set_ylabel("Coordination overhead (token ratio)")
    ax.set_title("(b) Coordination tax", fontsize=9.5)
    ax.set_xticks(xs); ax.set_xticklabels(names, rotation=28, ha="right", fontsize=7.5)
    for b, v in zip(bars, co_overall):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.05, f"{v:.2f}×",
                ha="center", fontsize=7, color="#333")
    fig.savefig(os.path.join(FIGDIR, "fig2_paradox.pdf"))
    fig.savefig(os.path.join(FIGDIR, "fig2_paradox.png"))
    plt.close(fig)

    # ============ Figure 3: scenario heatmap ============
    fig, ax = plt.subplots(figsize=(4.6, 2.6))
    mat = np.zeros((len(MODELS), len(SCENARIOS)))
    for i, (_, key, *_ ) in enumerate(MODELS):
        if key not in stats_all: continue
        by_o = stats_all[key][1]
        for j, sc in enumerate(SCENARIOS):
            mat[i, j] = np.mean(by_o[sc]) if by_o.get(sc) else np.nan
    im = ax.imshow(mat, cmap="RdYlGn", vmin=0.82, vmax=1.06, aspect="auto")
    ax.set_xticks(range(len(SCENARIOS)))
    ax.set_xticklabels([SCEN_LABEL[s] for s in SCENARIOS], fontsize=7.5)
    ax.set_yticks(range(len(MODELS)))
    ax.set_yticklabels([f"{m[0]}\n({m[2]})" for m in MODELS], fontsize=7.5)
    for i in range(mat.shape[0]):
        for j in range(mat.shape[1]):
            if not np.isnan(mat[i, j]):
                ax.text(j, i, f"{mat[i, j]:.2f}", ha="center", va="center", fontsize=7.2,
                        color="black")
    cbar = fig.colorbar(im, ax=ax, shrink=0.85, pad=0.02)
    cbar.set_label("CTR", fontsize=8.5)
    ax.set_title("CTR by office scenario", fontsize=9.5)
    fig.savefig(os.path.join(FIGDIR, "fig3_scenario_heatmap.pdf"))
    fig.savefig(os.path.join(FIGDIR, "fig3_scenario_heatmap.png"))
    plt.close(fig)

    print(f"\n[done] figures -> {FIGDIR}")
    # 附:打印聚合数值供论文表格核对
    print("\n=== Table check: CTR by coupling ===")
    hdr = "model      " + "".join(f"{l:>8}" for _, l in COUPLINGS) + "     overall    CO"
    print(hdr)
    for name, key, *_ in MODELS:
        if key not in stats_all: continue
        by_c, by_o, ctrs, tok = stats_all[key]
        row = f"{name:<11}"
        for c, _ in COUPLINGS:
            row += f"{np.mean(by_c[c]):>8.3f}"
        row += f"{np.mean(ctrs):>10.3f}{np.mean(tok):>7.2f}x"
        print(row)

if __name__ == "__main__":
    main()
