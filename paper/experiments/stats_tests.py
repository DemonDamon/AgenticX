#!/usr/bin/env python
"""v0.4 统计显著性检验:
(1) 每模型: H0: Q_team = Q_single (Wilcoxon signed-rank, 配对)
(2) 每模型×耦合档: 同上
(3) 家族内梯度差: Flash vs Pro / K2.6 vs K3 的 CTR 差异 (Mann-Whitney U)
(4) PROJ 场景 vs 其他场景 CTR (Mann-Whitney U)
"""
import json, os, math
from collections import defaultdict

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

EXP_PATHS = {
    "flash":    ["paper/experiments/baseline_v0.2b_dsv4flash_v3prompt/summary.jsonl"],
    "pro":      ["paper/experiments/baseline_v0.3_pro/summary.jsonl"],
    "kimi_k26": ["paper/experiments/baseline_v0.5_kimi_k26/summary.jsonl",
                 "paper/experiments/baseline_v0.5_kimi_k26_fix/summary.jsonl"],
    "kimi_k3":  ["paper/experiments/baseline_v0.4_kimi_k3/summary.jsonl"],
    "glm53":    ["paper/experiments/baseline_v0.6_glm53/summary.jsonl",
                 "paper/experiments/baseline_v0.6_glm53_fix/summary.jsonl"],
}
LABEL = {"flash": "DS-Flash", "pro": "DS-Pro", "kimi_k26": "Kimi-K2.6",
         "kimi_k3": "Kimi-K3", "glm53": "GLM-5.3"}

def load_pairs():
    out = {}
    for key, paths in EXP_PATHS.items():
        runs = {}
        for p in paths:
            fp = os.path.normpath(os.path.join(ROOT, p))
            if not os.path.exists(fp): continue
            for l in open(fp):
                if not l.strip(): continue
                r = json.loads(l)
                if r.get("error"): continue
                runs[(r["task_id"], r["mode"], r["seed"])] = r
        pairs = {}
        for (t, m, s), r in runs.items():
            pairs.setdefault((t, s), {})[m] = r
        out[key] = {k: v for k, v in pairs.items() if "single" in v and "team" in v}
    return out

# ---------- 无 scipy,手写 Wilcoxon signed-rank (正态近似,带连续性校正) ----------
def norm_sf(z):
    return 0.5 * math.erfc(z / math.sqrt(2.0))

def wilcoxon(diffs):
    """返回 (W, p) 双侧, 零差剔除, 正态近似 + 连续性校正 + 结修正"""
    d = [x for x in diffs if abs(x) > 1e-12]
    n = len(d)
    if n < 5:
        return None, None, n
    ranks = sorted((abs(x), i) for i, x in enumerate(d))
    # 结修正:相同 |d| 共享平均秩
    abs_vals = [a for a, _ in ranks]
    r = [0.0] * n
    i = 0
    tie_term = 0.0
    while i < n:
        j = i
        while j + 1 < n and abs_vals[j+1] == abs_vals[i]: j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j+1): r[ranks[k][1]] = avg
        t = j - i + 1
        if t > 1: tie_term += t**3 - t
        i = j + 1
    Wp = sum(r[i] for i in range(n) if d[i] > 0)
    Wm = sum(r[i] for i in range(n) if d[i] < 0)
    W = min(Wp, Wm)
    mu = n * (n + 1) / 4
    sigma2 = n * (n + 1) * (2 * n + 1) / 24 - tie_term / 48
    sigma = math.sqrt(sigma2)
    z = (W - mu + 0.5 * (1 if W < mu else -1)) / sigma
    p = 2 * norm_sf(abs(z))
    return W, p, n

def mannwhitney(a, b):
    """a, b 两组独立样本, 返回 (U, p) 双侧正态近似"""
    m, n = len(a), len(b)
    if m < 3 or n < 3: return None, None
    allv = sorted([(v, 0) for v in a] + [(v, 1) for v in b])
    ranks = [0.0] * (m + n)
    i = 0; tie_term = 0.0
    while i < len(allv):
        j = i
        while j + 1 < len(allv) and allv[j+1][0] == allv[i][0]: j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j+1): ranks[k] = avg
        t = j - i + 1
        if t > 1: tie_term += t**3 - t
        i = j + 1
    R_a = sum(ranks[i] for i in range(len(allv)) if allv[i][1] == 0)
    U1 = R_a - m * (m + 1) / 2
    U = min(U1, m * n - U1)
    mu = m * n / 2
    sigma = math.sqrt(m * n * (m + n + 1) / 12 - tie_term / (12 * (m + n)))
    if sigma == 0: return U, 1.0
    z = (U - mu + 0.5 * (1 if U < mu else -1)) / sigma
    p = 2 * norm_sf(abs(z))
    return U, p

def stars(p):
    if p is None: return ""
    if p < 0.001: return "***"
    if p < 0.01: return "**"
    if p < 0.05: return "*"
    return "n.s."

def main():
    pairs_all = load_pairs()

    print("=" * 74)
    print("表 S1. 团队 vs 个体质量差 (Q_team - Q_single), Wilcoxon signed-rank")
    print("=" * 74)
    print(f"{'model':<11}{'n':>4}{'mean Δ':>9}{'W':>7}{'p':>12}  sig")
    for key in EXP_PATHS:
        pairs = pairs_all[key]
        diffs = [d["team"]["Q"] - d["single"]["Q"] for d in pairs.values()]
        W, p, n = wilcoxon(diffs)
        md = sum(diffs) / len(diffs)
        print(f"{LABEL[key]:<11}{n:>4}{md:>+9.4f}{W if W else float('nan'):>7.0f}"
              f"{p if p is not None else float('nan'):>12.4g}  {stars(p)}")

    print()
    print("=" * 74)
    print("表 S2. 按耦合档 (Wilcoxon, n=10/档)")
    print("=" * 74)
    for key in EXP_PATHS:
        pairs = pairs_all[key]
        by_c = defaultdict(list)
        for (t, s), d in pairs.items():
            by_c[t.split("-")[2][0]].append(d["team"]["Q"] - d["single"]["Q"])
        row = f"{LABEL[key]:<11}"
        for c in ["L", "M", "H"]:
            diffs = by_c[c]
            W, p, n = wilcoxon(diffs)
            row += f"  {c}: n={n} Δ={sum(diffs)/len(diffs):+.3f} p={p:.3f} {stars(p)}" if p else f"  {c}: n={n} Δ={sum(diffs)/len(diffs):+.3f} p=n/a"
        print(row)

    print()
    print("=" * 74)
    print("表 S3. 家族内梯度: CTR 分布差异 (Mann-Whitney U, 双侧)")
    print("=" * 74)
    def ctrs(key):
        return [d["team"]["Q"] / d["single"]["Q"] for d in pairs_all[key].values()
                if d["single"]["Q"] > 0]
    for a, b, name in [("flash", "pro", "DS: Flash vs Pro"),
                       ("kimi_k26", "kimi_k3", "Kimi: K2.6 vs K3")]:
        ca, cb = ctrs(a), ctrs(b)
        U, p = mannwhitney(ca, cb)
        print(f"  {name}: n={len(ca)}/{len(cb)} mean={sum(ca)/len(ca):.3f}/{sum(cb)/len(cb):.3f} "
              f"U={U:.0f} p={p:.3f} {stars(p)}")

    print()
    print("=" * 74)
    print("表 S4. PROJ 场景 vs 其他场景 CTR (Mann-Whitney U, 双侧, 每模型)")
    print("=" * 74)
    for key in EXP_PATHS:
        proj, other = [], []
        for (t, s), d in pairs_all[key].items():
            if d["single"]["Q"] <= 0: continue
            c = d["team"]["Q"] / d["single"]["Q"]
            (proj if t.split("-")[1] == "PROJ" else other).append(c)
        U, p = mannwhitney(proj, other)
        print(f"  {LABEL[key]}: PROJ n={len(proj)} mean={sum(proj)/len(proj):.3f} | "
              f"other n={len(other)} mean={sum(other)/len(other):.3f} | "
              f"U={U:.0f} p={p if p else float('nan'):.3f} {stars(p)}")

if __name__ == "__main__":
    main()
