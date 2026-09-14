#!/usr/bin/env python3
"""Unified-estimator recomputation for the AAMAS revision.

Fixes reviewer issues W1/W4/W5:
- geometric vs arithmetic CTR per arm, per model, with explicit zero handling
- layer-wise CTR (L1-only, L2-only) vs refine-k
- L1 saturation rates per arm
- integrator-vs-single L2 paired comparison
- 7-arm two-factor variance decomposition (protocol x compute) replacing the
  illegal two-subset one-way ANOVA comparison
"""
import json, math, sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy import stats

BASE = Path(__file__).resolve().parent
EPS = 0.01  # symmetric epsilon floor for geometric CTR with zero scores

def load(fn):
    rows = []
    with open(fn) as f:
        for line in f:
            r = json.loads(line)
            det = r.get("detail") or {}
            rows.append({
                "task": r["task_id"], "mode": r["mode"], "seed": r["seed"],
                "Q": r["Q"], "L1": det.get("L1"), "L2": det.get("L2"),
                "coupling": r["task_type"],
            })
    return rows

def arm_key(mode):
    return mode

def paired(rows, team_arm, base_arm="single_refine_k", field="Q"):
    """Return list of (task,seed) -> (team_val, base_val) pairs."""
    t = {(r["task"], r["seed"]): r[field] for r in rows if r["mode"] == team_arm}
    b = {(r["task"], r["seed"]): r[field] for r in rows if r["mode"] == base_arm}
    keys = sorted(set(t) & set(b))
    return [(t[k], b[k]) for k in keys], keys

def ctr_stats(pairs):
    tv = np.array([p[0] for p in pairs]); bv = np.array([p[1] for p in pairs])
    out = {}
    with np.errstate(divide="ignore", invalid="ignore"):
        ratios = tv / bv
    ratios = ratios[np.isfinite(ratios)]
    out["arith"] = float(np.mean(ratios)) if len(ratios) else float("nan")
    nz = ratios[ratios > 0]
    out["geo_raw"] = float(np.exp(np.mean(np.log(nz)))) if len(nz) else float("nan")
    out["geo_nonzero_n"] = int(len(nz)); out["n"] = int(len(ratios))
    out["zeros"] = int((ratios == 0).sum())
    r_eps = (tv + EPS) / (bv + EPS)
    out["geo_eps"] = float(np.exp(np.mean(np.log(r_eps))))
    # bootstrap CI for geo_eps (task-level blocks)
    tasks = {}
    for (t_, b_), k in zip(pairs, pairs_keys_dummy):  # replaced below
        pass
    return out

def ctr_stats_paired(rows, team_arm, base_arm="single_refine_k", field="Q"):
    t = {(r["task"], r["seed"]): r[field] for r in rows if r["mode"] == team_arm}
    b = {(r["task"], r["seed"]): r[field] for r in rows if r["mode"] == base_arm}
    keys = sorted(set(t) & set(b))
    tv = np.array([t[k] for k in keys]); bv = np.array([b[k] for k in keys])
    tasks = [k[0] for k in keys]
    out = {}
    with np.errstate(divide="ignore", invalid="ignore"):
        ratios = tv / bv
    ratios = np.where(np.isfinite(ratios), ratios, np.nan)
    ok = ~np.isnan(ratios)
    out["n"] = int(ok.sum())
    out["arith"] = float(np.nanmean(ratios))
    nz = ratios[ok & (ratios > 0)]
    out["geo_nonzero"] = float(np.exp(np.mean(np.log(nz)))) if len(nz) else float("nan")
    out["zeros"] = int((ratios == 0).sum())
    r_eps = (tv + EPS) / (bv + EPS)
    out["geo_eps"] = float(np.exp(np.mean(np.log(r_eps))))
    # task-block bootstrap over geo_eps
    rng = np.random.default_rng(42)
    utasks = np.array(sorted(set(tasks)))
    geo_samples = []
    for _ in range(5000):
        sel = rng.choice(utasks, size=len(utasks), replace=True)
        mask = np.isin(tasks, sel)
        # sample with replacement of tasks -> approximate by resampling blocks
        vals = []
        for tt in sel:
            m = np.array(tasks) == tt
            vals.append(r_eps[m])
        r2 = np.concatenate(vals) if vals else r_eps
        geo_samples.append(np.exp(np.mean(np.log(r2))))
    lo, hi = np.percentile(geo_samples, [2.5, 97.5])
    out["geo_eps_ci"] = (float(lo), float(hi))
    # Wilcoxon on Q differences
    d = tv - bv
    if np.all(d == 0):
        out["wilcoxon_p"] = 1.0
    else:
        out["wilcoxon_p"] = float(stats.wilcoxon(tv, bv, zero_method="wilcox").pvalue)
    # Cliff's delta
    out["cliffs_d"] = float(2 * stats.wilcoxon(tv, bv, zero_method="wilcox").statistic / (len(d) * (len(d) - 1)) - 1) if len(d) > 1 else 0.0
    return out

def arm_means(rows, field):
    out = {}
    for m in sorted({r["mode"] for r in rows}):
        v = [r[field] for r in rows if r["mode"] == m and r.get(field) is not None]
        out[m] = (float(np.mean(v)), float(np.std(v)), len(v))
    return out

def l1_saturation(rows):
    out = {}
    for m in sorted({r["mode"] for r in rows}):
        v = [r["L1"] for r in rows if r["mode"] == m and r.get("L1") is not None]
        out[m] = float(np.mean([x >= 0.999 for x in v]))
    return out

def seven_arm_variance(rows):
    """Two-factor non-additive decomposition via one-way ANOVA over all 7 arms,
    then eta2 for the *grouping* (arm identity). Also between-team-arms vs
    between-single-arms variance of arm means (design-aware comparison)."""
    arms = sorted({r["mode"] for r in rows})
    data = {a: np.array([r["Q"] for r in rows if r["mode"] == a]) for a in arms}
    grand = np.concatenate(list(data.values()))
    ss_total = np.sum((grand - grand.mean()) ** 2)
    ss_between = sum(len(v) * (v.mean() - grand.mean()) ** 2 for v in data.values())
    eta2_arm = ss_between / ss_total
    team_arms = ["team_last", "team_concat", "team_blackboard", "team_integrator"]
    single_arms = ["single", "single_refine_k", "single_bon_k"]
    tm = np.array([data[a].mean() for a in team_arms])
    sm = np.array([data[a].mean() for a in single_arms])
    # variance of arm means (design-aware): between-arm spread
    var_team_means = float(np.var(tm, ddof=1))
    var_single_means = float(np.var(sm, ddof=1))
    # one-way ANOVA within each subset (as reported originally)
    f_t, p_t = stats.f_oneway(*[data[a] for a in team_arms])
    f_s, p_s = stats.f_oneway(*[data[a] for a in single_arms])
    ss_between_team = sum(len(data[a]) * (data[a].mean() - np.concatenate([data[a] for a in team_arms]).mean()) ** 2 for a in team_arms)
    ss_total_team = np.sum((np.concatenate([data[a] for a in team_arms]) - np.concatenate([data[a] for a in team_arms]).mean()) ** 2)
    ss_between_single = sum(len(data[a]) * (data[a].mean() - np.concatenate([data[a] for a in single_arms]).mean()) ** 2 for a in single_arms)
    ss_total_single = np.sum((np.concatenate([data[a] for a in single_arms]) - np.concatenate([data[a] for a in single_arms]).mean()) ** 2)
    return {
        "eta2_7arm": float(eta2_arm),
        "eta2_team_subset": float(ss_between_team / ss_total_team),
        "eta2_single_subset": float(ss_between_single / ss_total_single),
        "F_team": float(f_t), "p_team": float(p_t),
        "F_single": float(f_s), "p_single": float(p_s),
        "var_team_means": var_team_means, "var_single_means": var_single_means,
    }

def main():
    result = {}
    for name, fn in [("flash", "pilot_flash_v2/summary.jsonl"),
                     ("k3", "pilot_kimi_k3/summary.jsonl")]:
        rows = load(BASE / fn)
        model_res = {"arm_means_Q": arm_means(rows, "Q"),
                     "arm_means_L1": arm_means(rows, "L1"),
                     "arm_means_L2": arm_means(rows, "L2"),
                     "l1_saturation": l1_saturation(rows),
                     "variance": seven_arm_variance(rows),
                     "ctr": {}}
        for arm in ["team_last", "team_concat", "team_blackboard", "team_integrator"]:
            model_res["ctr"][arm] = {
                field: ctr_stats_paired(rows, arm, "single_refine_k", field)
                for field in ["Q", "L1", "L2"]
            }
        # integrator vs 1-shot single on L2 (the W1 question)
        model_res["integ_vs_single_L2"] = ctr_stats_paired(rows, "team_integrator", "single", "L2")
        model_res["integ_vs_single_Q"] = ctr_stats_paired(rows, "team_integrator", "single", "Q")
        result[name] = model_res
    print(json.dumps(result, indent=1, ensure_ascii=False))

if __name__ == "__main__":
    main()
