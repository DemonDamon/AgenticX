#!/usr/bin/env python
"""§5.5 分析:(1) judge 双轮一致性 (2) L3 on/off ablation(CTR 是否翻转)"""
import json, os, sys
from collections import defaultdict

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

JUDGE_FILE = os.path.join(ROOT, "paper/experiments/judge_v0.1/judge_results.jsonl")
EXP_PATHS = {
    "flash":    ["paper/experiments/baseline_v0.2b_dsv4flash_v3prompt/summary.jsonl"],
    "kimi_k3":  ["paper/experiments/baseline_v0.4_kimi_k3/summary.jsonl"],
    "pro":      ["paper/experiments/baseline_v0.3_pro/summary.jsonl"],
    "kimi_k26": ["paper/experiments/baseline_v0.5_kimi_k26/summary.jsonl",
                 "paper/experiments/baseline_v0.5_kimi_k26_fix/summary.jsonl"],
    "glm53":    ["paper/experiments/baseline_v0.6_glm53/summary.jsonl",
                 "paper/experiments/baseline_v0.6_glm53_fix/summary.jsonl"],
}

def load_judge():
    by = defaultdict(dict)  # (exp_key,task,mode,seed) -> {round: L3}
    for l in open(JUDGE_FILE):
        if not l.strip(): continue
        d = json.loads(l)
        by[(d["exp_key"], d["task_id"], d["mode"], d["seed"])][d["round"]] = d["L3"]
    return by

def load_runs():
    runs = {}
    for key, paths in EXP_PATHS.items():
        rs = {}
        for p in paths:
            fp = os.path.normpath(os.path.join(ROOT, p))
            if not os.path.exists(fp): continue
            for l in open(fp):
                if not l.strip(): continue
                r = json.loads(l)
                if r.get("error"): continue
                rs[(r["task_id"], r["mode"], r["seed"])] = r
        runs[key] = rs
    return runs

def spearman(a, b):
    def rank(x):
        order = sorted(range(len(x)), key=lambda i: x[i])
        r = [0]*len(x); i = 0
        while i < len(order):
            j = i
            while j+1 < len(order) and x[order[j+1]] == x[order[i]]: j += 1
            avg = (i + j)/2 + 1
            for k in range(i, j+1): r[order[k]] = avg
            i = j+1
        return r
    ra, rb = rank(a), rank(b)
    ma, mb = sum(ra)/len(ra), sum(rb)/len(rb)
    num = sum((ra[i]-ma)*(rb[i]-mb) for i in range(len(a)))
    den = (sum((ra[i]-ma)**2 for i in range(len(a))) * sum((rb[i]-mb)**2 for i in range(len(b))))**0.5
    return num/den if den else 1.0

def main():
    judge = load_judge()
    runs = load_runs()

    print("=" * 60)
    print("分析 1: judge 双轮一致性(r0 vs r1,历史双轮数据)")
    print("=" * 60)
    for key in ["flash", "kimi_k3"]:
        pairs = [(v[0], v[1]) for (k, t, m, s), v in judge.items()
                 if k == key and v.get(0) is not None and v.get(1) is not None]
        if len(pairs) >= 5:
            a = [p[0] for p in pairs]; b = [p[1] for p in pairs]
            exact = sum(1 for x, y in zip(a, b) if abs(x-y) < 1e-9)
            mad = sum(abs(x-y) for x, y in zip(a, b))/len(a)
            print(f"  {key}: n={len(pairs)} 完全一致={exact}/{len(pairs)} "
                  f"平均绝对差={mad:.3f} Spearman={spearman(a,b):.3f}")

    print()
    print("=" * 60)
    print("分析 2: L3 on/off ablation —— Q' = Q + 0.2*(L3-0.6)")
    print("=" * 60)
    header = f"{'model':<10} {'CTR_L3off':>9} {'CTR_L3on':>9} {'Δ':>7}  耦合档(on/off)"
    print(header)
    for key in ["flash", "pro", "kimi_k3", "kimi_k26", "glm53"]:
        rs = runs.get(key, {})
        pairs = defaultdict(dict)
        for (t, m, s), r in rs.items():
            pairs[(t, s)][m] = r
        by_c_off = defaultdict(list); by_c_on = defaultdict(list)
        ctrs_off, ctrs_on = [], []
        for (t, s), d in pairs.items():
            if "single" not in d or "team" not in d or d["single"]["Q"] <= 0: continue
            ok = True; qs_off = d["single"]["Q"]; qt_off = d["team"]["Q"]
            qs_on = qt_on = None
            L3s = judge.get((key, t, "single", s), {}).get(0)
            L3t = judge.get((key, t, "team", s), {}).get(0)
            if L3s is None or L3t is None: ok = False
            if ok:
                qs_on = qs_off + 0.2*(L3s - 0.6)
                qt_on = qt_off + 0.2*(L3t - 0.6)
                qs_on = min(1.0, qs_on); qt_on = min(1.0, qt_on)
                if qs_on <= 0: ok = False
            c = t.split("-")[2][0]
            ctrs_off.append(qt_off/qs_off)
            by_c_off[c].append(qt_off/qs_off)
            if ok:
                ctrs_on.append(qt_on/qs_on)
                by_c_on[c].append(qt_on/qs_on)
        n_off = len(ctrs_off); n_on = len(ctrs_on)
        if n_off == 0:
            print(f"  {key}: 无数据"); continue
        m_off = sum(ctrs_off)/n_off
        if n_on:
            m_on = sum(ctrs_on)/n_on
            cells = []
            for c in ["L", "M", "H"]:
                if by_c_off.get(c) and by_c_on.get(c):
                    cells.append(f"{c}:{sum(by_c_off[c])/len(by_c_off[c]):.3f}/"
                                 f"{sum(by_c_on[c])/len(by_c_on[c]):.3f}")
            print(f"  {key:<10} {m_off:>9.3f} {m_on:>9.3f} {m_on-m_off:>+7.3f}  "
                  f"n={n_off}/{n_on}  {' '.join(cells)}")
        else:
            print(f"  {key:<10} {m_off:>9.3f} {'(judge未齐)':>9}          n={n_off}")

if __name__ == "__main__":
    main()
