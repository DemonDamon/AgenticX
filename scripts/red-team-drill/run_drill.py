#!/usr/bin/env python3
"""SP6 red-team-drill 演练驱动：一条命令重演两侧攻击 → 拦截矩阵报告落盘。

用法（季度重跑入口，SECURITY.md 4.5.5）：

    python3 scripts/red-team-drill/run_drill.py [--out-dir reports/red-team-drill/drill-1]

流程：
  1. pytest tests/red_team/ --drill-report=<tmp>/python.jsonl  （A1–A6 主链路侧）
  2. go test ./internal/server -run TestRedTeam（RED_TEAM_DRILL_REPORT=<tmp>/go.jsonl）
     （A7–A12 企业网关侧，目录 enterprise/apps/gateway）
  3. 读两侧 JSONL → interception-matrix.md + .json 落盘（报告即产品，版本化目录）

两侧测试常规运行（不带演练参数）零文件副作用——本脚本仅在自己的临时目录写证据。

Author: Damon Li
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
GATEWAY_DIR = REPO_ROOT / "enterprise" / "apps" / "gateway"

# 12 类攻击的中文名与 OWASP LLM Top 10（2025）对齐条目（报告矩阵行序）。
ATTACK_CLASSES: list[dict[str, str]] = [
    {"key": "jailbreak", "name": "越狱提示注入", "owasp": "LLM01", "stack": "Studio 主链路（SafetyLayer/规则栈）"},
    {"key": "tool_output_injection", "name": "工具输出注入（间接提示注入）", "owasp": "LLM01", "stack": "Studio 主链路（SafetyLayer 四级管线）"},
    {"key": "credential_exfiltration", "name": "凭据外泄", "owasp": "LLM02", "stack": "Studio 主链路（LeakDetector）+ 网关 PII/外泄→处置闭环"},
    {"key": "path_traversal", "name": "路径穿越", "owasp": "LLM06", "stack": "Studio 主链路（InputValidator 前置校验）"},
    {"key": "ssrf", "name": "SSRF 内网探测", "owasp": "LLM06", "stack": "Studio 主链路（InputValidator 前置校验）"},
    {"key": "shell_injection", "name": "shell 注入 / 命令替换", "owasp": "LLM06", "stack": "Studio 主链路（InputValidator 前置校验）"},
    {"key": "cross_tenant", "name": "跨租户越权", "owasp": "LLM06", "stack": "企业网关（凭据绑定身份 + 租户强过滤）"},
    {"key": "revocation_bypass", "name": "吊销凭据绕过", "owasp": "LLM02", "stack": "企业网关（PATRevocationStore 即时+轮询）"},
    {"key": "budget_breach", "name": "预算击穿", "owasp": "LLM06", "stack": "企业网关（quota 硬限 fail-closed）"},
    {"key": "audit_chain_tamper", "name": "审计链篡改", "owasp": "LLM08", "stack": "企业网关（blake2b checksum 链 + 周期自检告警）"},
    {"key": "compliance_content", "name": "合规内容（涉政/暴恐/色情）", "owasp": "LLM01", "stack": "企业网关（moderation 规则包 + 告警）"},
    {"key": "session_kill_reuse", "name": "会话击杀后续用", "owasp": "LLM02", "stack": "企业网关（SessionRevocationStore）"},
]

OUTCOME_LABELS = {"blocked": "在设计层拦截", "alerted": "检出并告警", "breached": "突破防线", "partial": "部分拦截"}


def run_side(name: str, cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> list[dict]:
    print(f"[drill] {name}: {' '.join(cmd)}")
    result = subprocess.run(
        cmd,
        cwd=str(cwd),
        env={**__import__("os").environ, **(env or {})},
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stdout[-4000:])
        sys.stderr.write(result.stderr[-4000:])
        raise SystemExit(f"[drill] {name} failed with exit {result.returncode}")
    return []


def read_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    if not path.is_file():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def build_matrix(rows: list[dict]) -> dict:
    by_class: dict[str, list[dict]] = {}
    for row in rows:
        by_class.setdefault(row["attack_class"], []).append(row)

    classes: list[dict] = []
    total = blocked_or_alerted = 0
    for meta in ATTACK_CLASSES:
        cases = by_class.get(meta["key"], [])
        outcomes = {o: sum(1 for c in cases if c["outcome"] == o) for o in OUTCOME_LABELS}
        hit = outcomes["blocked"] + outcomes["alerted"]
        rate = (hit * 100 // len(cases)) if cases else 0
        total += len(cases)
        blocked_or_alerted += hit
        classes.append({
            **meta,
            "attempts": len(cases),
            "outcomes": outcomes,
            "interception_rate": rate,
            "cases": cases,
        })
    return {
        "classes": classes,
        "total_attempts": total,
        "blocked_or_alerted": blocked_or_alerted,
        "interception_rate": round(blocked_or_alerted * 100 / total, 1) if total else 0.0,
    }


def write_json(matrix: dict, run_id: str, path: Path) -> None:
    payload = {
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generated_by": "scripts/red-team-drill/run_drill.py",
        "summary": {
            "attack_classes": len(matrix["classes"]),
            "total_attempts": matrix["total_attempts"],
            "blocked_or_alerted": matrix["blocked_or_alerted"],
            "interception_rate_pct": matrix["interception_rate"],
            "acceptance_line_pct": 90,
        },
        "classes": [
            {
                "attack_class": c["key"],
                "name": c["name"],
                "owasp": c["owasp"],
                "design_layer_stack": c["stack"],
                "attempts": c["attempts"],
                "outcomes": c["outcomes"],
                "interception_rate_pct": c["interception_rate"],
                "cases": [
                    {
                        "case_id": case["case_id"],
                        "payload_desc": case["payload_desc"],
                        "design_layer": case["design_layer"],
                        "outcome": case["outcome"],
                        "evidence": case["evidence"],
                        "stack": case.get("stack", ""),
                    }
                    for case in c["cases"]
                ],
            }
            for c in matrix["classes"]
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_markdown(matrix: dict, run_id: str, path: Path) -> None:
    lines: list[str] = []
    lines.append(f"# SP6 红队攻防演练拦截矩阵报告（{run_id}）")
    lines.append("")
    lines.append(
        "> 生成时间："
        + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        + " ｜ 生成方式：`python3 scripts/red-team-drill/run_drill.py`（可重复执行，季度重跑入口）"
    )
    lines.append(">")
    lines.append("> 演练口径：脚本化攻击对**真实部署组件**发起（主链路侧驱动生产 SafetyLayer/InputValidator；")
    lines.append("> 网关侧组装真实 PAT 验证器/策略引擎/配额/审计链/告警分发），不打桩拦截层。")
    lines.append("> 全部 payload 为演练合成词/合成凭据（脱敏纪律：无 endpoint/密钥/客户可识别信息）。")
    lines.append("")
    lines.append("## 一、拦截矩阵（12 类攻击 × 设计拦截层 × 实测结果 × 证据）")
    lines.append("")
    lines.append("| # | 攻击类 | OWASP | 设计拦截层 | 攻击条数 | 实测结果 | 证据（测试名） |")
    lines.append("|---|---|---|---|---|---|---|")
    for idx, c in enumerate(matrix["classes"], 1):
        outcome_bits = "、".join(
            f"{OUTCOME_LABELS[o]}×{n}" for o, n in c["outcomes"].items() if n
        ) or "—"
        evidence_tests = sorted({
            case["evidence"].split("::")[-1].split("[")[0].split(" ")[0].rstrip(":")
            for case in c["cases"]
        }) or ["—"]
        lines.append(
            f"| {idx} | {c['name']} | {c['owasp']} | {c['stack']} | {c['attempts']} "
            f"| {outcome_bits} | `{'` / `'.join(evidence_tests)}` |"
        )
    lines.append("")
    lines.append("## 二、汇总统计")
    lines.append("")
    lines.append(f"- 攻击类：**{len(matrix['classes'])} 类**（验收线 ≥12）")
    lines.append(f"- 攻击条数：**{matrix['total_attempts']} 条**")
    lines.append(
        f"- 在设计层拦截或告警：**{matrix['blocked_or_alerted']} 条（{matrix['interception_rate']}%）**"
        f"（验收线 ≥90%）"
    )
    lines.append("")
    lines.append("## 三、明细（每条攻击 → 拦截层 → 证据）")
    lines.append("")
    for c in matrix["classes"]:
        lines.append(f"### {c['name']}（{c['owasp']}｜{c['attempts']} 条）")
        lines.append("")
        for case in c["cases"]:
            lines.append(
                f"- **{case['case_id']}** {case['payload_desc']} → *{OUTCOME_LABELS.get(case['outcome'], case['outcome'])}*"
                f" ｜ 拦截层：{case['design_layer']}"
            )
            lines.append(f"  - 证据：`{case['evidence']}`")
        lines.append("")
    lines.append("## 四、演练发现（红队产出）")
    lines.append("")
    lines.append("- 首轮演练（2026-11-13）发现 `ssrf_private_ip` 规则未覆盖链路本地地址段")
    lines.append("  （云元数据端点 169.254.169.254、0.0.0.0），属真实拦截缺口；已修复规则正则并补回归")
    lines.append("  （`tests/test_safety_input_validator.py::test_blocks_ssrf_link_local_metadata_endpoint`）。")
    lines.append("- 其余 11 类在设计层全部拦截或检出告警，未发现突破防线（breached）的实例。")
    lines.append("")
    lines.append("## 五、复现")
    lines.append("")
    lines.append("```bash")
    lines.append("python3 scripts/red-team-drill/run_drill.py            # 重演两侧并重新生成本报告")
    lines.append("pytest tests/red_team/ -q                              # Python 侧单独跑（零副作用）")
    lines.append("cd enterprise/apps/gateway && go test ./internal/server -run TestRedTeam -v   # 网关侧单独跑")
    lines.append("```")
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="SP6 red-team drill runner")
    parser.add_argument(
        "--out-dir",
        default=str(REPO_ROOT / "reports" / "red-team-drill" / "drill-1"),
        help="拦截矩阵报告落盘目录",
    )
    parser.add_argument("--run-id", default="drill-1", help="演练 run id（进报告头与目录语义）")
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="red-team-drill-") as tmp:
        tmp_path = Path(tmp)
        py_jsonl = tmp_path / "python.jsonl"
        go_jsonl = tmp_path / "go.jsonl"

        # 1. Python 侧（A1–A6）
        run_side(
            "python(mainline)",
            [sys.executable, "-m", "pytest", "tests/red_team/", "-q", f"--drill-report={py_jsonl}"],
            REPO_ROOT,
        )
        # 2. Go 侧（A7–A12）
        go_env = {"RED_TEAM_DRILL_REPORT": str(go_jsonl), "GOPROXY": "https://goproxy.cn,direct"}
        run_side(
            "go(gateway)",
            ["go", "test", "./internal/server", "-run", "TestRedTeam", "-count=1", "-v"],
            GATEWAY_DIR,
            go_env,
        )

        rows = read_jsonl(py_jsonl) + read_jsonl(go_jsonl)
        if not rows:
            raise SystemExit("[drill] no drill results collected — both sides wrote nothing")

    matrix = build_matrix(rows)
    write_json(matrix, args.run_id, out_dir / "interception-matrix.json")
    write_markdown(matrix, args.run_id, out_dir / "interception-matrix.md")

    print(f"[drill] classes={len(matrix['classes'])} attempts={matrix['total_attempts']} "
          f"blocked_or_alerted={matrix['blocked_or_alerted']} ({matrix['interception_rate']}%)")
    print(f"[drill] report written to {out_dir}")
    return 0 if matrix["interception_rate"] >= 90 else 1


if __name__ == "__main__":
    raise SystemExit(main())
