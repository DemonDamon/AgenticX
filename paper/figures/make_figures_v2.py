#!/usr/bin/env python
"""TeamBench v2 出图：双模型（DS v4 Flash + Kimi K3，各 15 任务 × 3 seeds × 7 臂 = 315 runs）。
产出:
  fig4_assembly_coupling.pdf/png   (a) Flash 热力图 (b) K3 热力图 (c) 双模型方差分解
  fig5_ctr_matched.pdf/png         integrator CTR_matched 分耦合档（双模型分组柱 + bootstrap 95% CI）
打印聚合数值供论文表格核对。
"""
import json, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # paper/
FIGDIR = os.path.join(ROOT, "figures")
os.makedirs(FIGDIR, exist_ok=True)
SUMMARIES = {
    "Flash": os.path.join(ROOT, "experiments", "v2", "pilot_flash_v2", "summary.jsonl"),
    "K3": os.path.join(ROOT, "experiments", "v2", "pilot_kimi_k3", "summary.jsonl"),
}
MODEL_COLOR = {"Flash": "#4C72B0", "K3": "#DD8452"}

ARMS = ["single", "single_refine_k", "single_bon_k",
        "team_last", "team_concat", "team_integrator", "team_blackboard"]
ARM_LABEL = {"single": "single (1-shot)", "single_refine_k": "single+refine-k",
             "single_bon_k": "single+best-of-k", "team_last": "team·last",
             "team_concat": "team·concat", "team_integrator": "team·integrator",
             "team_blackboard": "team·blackboard"}
COUPLINGS = ["L", "M", "H"]
COU_LABEL = ["Low", "Medium", "High"]
TEAM_ARMS = [a for a in ARMS if a.startswith("team_")]
REF = "single_refine_k"  # CTR_matched 分母

plt.rcParams.update({
    "font.size": 9, "axes.labelsize": 10, "axes.titlesize": 10,
    "xtick.labelsize": 8.5, "ytick.labelsize": 8.5, "legend.fontsize": 8,
    "axes.spines.top": False, "axes.spines.right": False,
    "figure.dpi": 300, "savefig.bbox": "tight",
})

def load(path):
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if not r.get("error"):
                rows.append(r)
    q = {}
    for r in rows:
        q[(r["task_id"], r["mode"], r["seed"])] = r["Q"]
    return rows, q

def coupling_of(tid):
    return tid.split("-")[2][0]

def eta2(groups):
    allv = np.concatenate(groups)
    gm = allv.mean()
    ss_b = sum(len(g) * (g.mean() - gm) ** 2 for g in groups)
    ss_t = ((allv - gm) ** 2).sum()
    return ss_b / ss_t if ss_t > 0 else 0.0

def main():
    data = {}
    for name, path in SUMMARIES.items():
        rows, q = load(path)
        tasks = sorted({r["task_id"] for r in rows})
        seeds = sorted({r["seed"] for r in rows})
        assert len(tasks) * len(seeds) * len(ARMS) == len(rows), f"{name} 矩阵不完整"
        # 热力图矩阵
        mat = np.zeros((len(ARMS), 3))
        for i, arm in enumerate(ARMS):
            for j, c in enumerate(COUPLINGS):
                qs = [q[(t, arm, s)] for t in tasks if coupling_of(t) == c for s in seeds]
                mat[i, j] = np.mean(qs)
        # 方差分解
        asm_groups = [np.array([q[(t, arm, s)] for t in tasks for s in seeds])
                      for arm in TEAM_ARMS]
        comp_groups = [np.array([q[(t, arm, s)] for t in tasks for s in seeds])
                       for arm in ["single", "single_refine_k", "single_bon_k"]]
        data[name] = dict(q=q, tasks=tasks, seeds=seeds, mat=mat,
                          eta_asm=eta2(asm_groups), eta_comp=eta2(comp_groups))

    # ============ Figure 4: 双模型热力图 + 方差分解 ============
    fig = plt.figure(figsize=(9.6, 3.0))
    gs = fig.add_gridspec(1, 3, width_ratios=[1.15, 1.15, 1.0], wspace=0.55)

    for k, (name, panel) in enumerate(zip(["Flash", "K3"], ["(a)", "(b)"])):
        ax = fig.add_subplot(gs[0, k])
        mat = data[name]["mat"]
        im = ax.imshow(mat, cmap="RdYlGn", vmin=0.25, vmax=0.95, aspect="auto")
        ax.set_xticks(range(3)); ax.set_xticklabels(COU_LABEL)
        if k == 0:
            ax.set_yticks(range(len(ARMS)))
            ax.set_yticklabels([ARM_LABEL[a] for a in ARMS], fontsize=8)
        else:
            ax.set_yticks([])
        for i in range(mat.shape[0]):
            for j in range(mat.shape[1]):
                ax.text(j, i, f"{mat[i, j]:.2f}", ha="center", va="center",
                        fontsize=7.2, color="black")
        ax.axhline(2.5, color="#333", lw=1.2)
        ax.set_title(f"{panel} Q by assembly × coupling — {name}", fontsize=9)
        ax.spines[:].set_visible(False)
        cbar = fig.colorbar(im, ax=ax, shrink=0.8, pad=0.02)
        cbar.set_label("Quality  Q", fontsize=8)
        cbar.ax.tick_params(labelsize=7)

    ax = fig.add_subplot(gs[0, 2])
    labels = ["Assembly\nprotocol", "Compute\nstrategy"]
    ys = np.arange(2)
    h = 0.32
    for off, name in zip([-h/2 - 0.02, h/2 + 0.02], ["Flash", "K3"]):
        vals = [data[name]["eta_asm"], data[name]["eta_comp"]]
        bars = ax.barh(ys + off, vals, height=h, color=MODEL_COLOR[name],
                       label=name)
        for b, v in zip(bars, vals):
            ax.text(v + 0.012, b.get_y() + b.get_height() / 2, f"{v*100:.1f}%",
                    va="center", fontsize=7.5, color="#333")
    ax.set_yticks(ys); ax.set_yticklabels(labels, fontsize=8)
    ax.invert_yaxis()
    ax.set_xlabel("Share of Q variance (η²)")
    ax.set_xlim(0, 0.62)
    ax.legend(loc="lower right", frameon=False)
    ax.set_title("(c) Variance decomposition", fontsize=9)
    fig.savefig(os.path.join(FIGDIR, "fig4_assembly_coupling.pdf"))
    fig.savefig(os.path.join(FIGDIR, "fig4_assembly_coupling.png"))
    plt.close(fig)

    # ============ Figure 5: integrator CTR_matched 分耦合档（双模型） ============
    rng = np.random.default_rng(0)
    fig, ax = plt.subplots(figsize=(5.0, 2.9))
    xs = np.arange(3)
    w = 0.36
    results = {}
    for k, name in enumerate(["Flash", "K3"]):
        q = data[name]["q"]; tasks = data[name]["tasks"]; seeds = data[name]["seeds"]
        means, los, his = [], [], []
        for c in COUPLINGS:
            ts = [t for t in tasks if coupling_of(t) == c]
            ratios = []
            for t in ts:
                for s in seeds:
                    qref = q[(t, REF, s)]
                    qteam = q[(t, "team_integrator", s)]
                    if qref > 0:
                        ratios.append(qteam / qref)
            ratios = np.array(ratios)
            # 与 stats_v2.log_ratio_ctr 口径一致：几何均值 + log 域配对 bootstrap CI
            log_r = np.log(ratios)
            idx = rng.integers(0, len(ratios), size=(10000, len(ratios)))
            boots = np.exp(log_r[idx].mean(axis=1))
            means.append(np.exp(log_r.mean()))
            los.append(np.percentile(boots, 2.5))
            his.append(np.percentile(boots, 97.5))
        results[name] = (means, los, his)
        pos = xs + (k - 0.5) * (w + 0.04)
        ax.bar(pos, means, color=MODEL_COLOR[name], width=w,
               yerr=[np.array(means) - np.array(los),
                     np.array(his) - np.array(means)],
               capsize=3, error_kw={"lw": 1.1}, label=name)
        for x, m, lo, hi in zip(pos, means, los, his):
            ax.text(x, m + 0.03, f"{m:.2f}", ha="center", fontsize=7.5, color="#333")
    ax.axhline(1.0, color="gray", ls="--", lw=0.9)
    ax.text(2.45, 1.02, "break-even", fontsize=7.5, color="gray", ha="right")
    ax.set_xticks(xs); ax.set_xticklabels(COU_LABEL)
    ax.set_xlabel("Task coupling level")
    ax.set_ylabel("CTR$_{matched}$ (integrator vs refine-k)")
    ax.set_ylim(0.8, 2.15)
    ax.legend(frameon=False, loc="upper left")
    fig.savefig(os.path.join(FIGDIR, "fig5_ctr_matched.pdf"))
    fig.savefig(os.path.join(FIGDIR, "fig5_ctr_matched.png"))
    plt.close(fig)

    # ============ 打印核对 ============
    for name in ["Flash", "K3"]:
        print(f"=== Fig4 {name} check: Q by arm × coupling ===")
        print("arm                 " + "".join(f"{l:>8}" for l in COU_LABEL))
        for i, arm in enumerate(ARMS):
            print(f"{ARM_LABEL[arm]:<20}"
                  + "".join(f"{data[name]['mat'][i, j]:>8.3f}" for j in range(3)))
        print(f"eta2: assembly={data[name]['eta_asm']:.3f} "
              f"compute={data[name]['eta_comp']:.3f}\n")
    print("=== Fig5 check: integrator CTR_matched (geo-mean, CI) ===")
    for name in ["Flash", "K3"]:
        means, los, his = results[name]
        for c, m, lo, hi in zip(COU_LABEL, means, los, his):
            print(f"  {name} {c}: {m:.3f}  CI[{lo:.3f},{hi:.3f}]")
    print(f"\n[done] figures -> {FIGDIR}")

if __name__ == "__main__":
    main()
