#!/usr/bin/env python3
"""按 ops.tsv 把 XML 片段定点写入飞书文档。每步带 --revision-id（取上一步返回的版本号），失败即停。

ops.tsv 用制表符分隔，首行是表头：
    op  command  block_id  end_block_id  content  cwd  note
- command：block_replace、block_insert_after、block_insert_before 等
- end_block_id：非空时改用 --start-block-id / --end-block-id，替换同一父级的连续块
- content：片段文件路径，相对 ops.tsv 所在目录；为空则不带 --content
- cwd：命令的工作目录，相对 ops.tsv 所在目录；片段里有 <whiteboard path="@./x.svg"> 时设到 SVG 所在目录
- note：备注

用法：
    apply_doc_ops.py --doc URL --ops edit/ops.tsv --dry --only A,B     # 演练
    apply_doc_ops.py --doc URL --ops edit/ops.tsv --base-rev 16        # 正式
不带 --base-rev 时，从日志里取上一次成功后的版本号继续。
"""
import argparse
import json
import os
import subprocess
import sys
import time


def load_ops(path):
    with open(path, encoding="utf-8") as f:
        lines = [ln.rstrip("\n") for ln in f if ln.strip()]
    head = lines[0].split("\t")
    return [dict(zip(head, ln.split("\t"))) for ln in lines[1:]]


def build(op, doc, ops_dir, rev, dry):
    cmd = ["lark-cli", "docs", "+update", "--doc", doc, "--as", "user",
           "--revision-id", str(rev), "--command", op["command"]]
    if op.get("end_block_id"):
        cmd += ["--start-block-id", op["block_id"], "--end-block-id", op["end_block_id"]]
    elif op.get("block_id"):
        cmd += ["--block-id", op["block_id"]]
    content = (op.get("content") or "").strip()
    if content:
        cmd += ["--content", "@" + os.path.abspath(os.path.join(ops_dir, content))]
    if dry:
        cmd.append("--dry-run")
    cwd = os.path.abspath(os.path.join(ops_dir, op.get("cwd") or ""))
    return cmd, cwd


def run_one(op, cmd, cwd, rev, dry):
    if not os.path.isdir(cwd):
        rec = {"op": op["op"], "rev_before": rev, "dry": dry, "ok": False,
               "error": f"工作目录不存在：{cwd}"}
        print(json.dumps(rec, ensure_ascii=False))
        return rec
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    out = proc.stdout.strip() or proc.stderr.strip()
    rec = {"op": op["op"], "rev_before": rev, "dry": dry}
    try:
        data = json.loads(out)
    except ValueError:
        rec.update(ok=None, raw=out[:800], exit=proc.returncode)
        print(json.dumps(rec, ensure_ascii=False))
        return rec
    body = data.get("data") or {}
    doc = body.get("document") or {}
    rec.update(ok=data.get("ok"), result=body.get("result"),
               error=data.get("error"), message=data.get("msg") or data.get("message"),
               updated=body.get("updated_blocks_count"),
               warnings=body.get("warnings"), rev_after=doc.get("revision_id"))
    print(json.dumps(rec, ensure_ascii=False))
    return rec


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--doc", required=True)
    ap.add_argument("--ops", required=True)
    ap.add_argument("--base-rev", type=int, help="基准版本号；省略则取日志里最后一次成功后的版本号")
    ap.add_argument("--only", help="只执行这些 op，逗号分隔")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--log", default="apply_log.jsonl")
    a = ap.parse_args()

    ops_dir = os.path.dirname(os.path.abspath(a.ops))
    ops = load_ops(a.ops)
    if a.only:
        wanted = a.only.split(",")
        ops = [o for o in ops if o["op"] in wanted]

    rev = a.base_rev
    if rev is None:
        rev = -1
        if os.path.exists(a.log):
            with open(a.log, encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        rec = json.loads(line)
                        if not rec.get("dry") and rec.get("rev_after"):
                            rev = rec["rev_after"]

    for op in ops:
        cmd, cwd = build(op, a.doc, ops_dir, rev, a.dry)
        rec = run_one(op, cmd, cwd, rev, a.dry)
        if a.dry:
            if not rec.get("ok"):
                print(f"演练失败于 {op['op']}：{op.get('note', '')}", file=sys.stderr)
                return 1
            continue
        with open(a.log, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        if not rec.get("ok") or rec.get("result") != "success":
            print(f"STOP at {op['op']}: {op.get('note', '')}", file=sys.stderr)
            return 1
        rev = rec["rev_after"] if isinstance(rec.get("rev_after"), int) and rec["rev_after"] > rev else rev + 1
        time.sleep(0.4)
    return 0


if __name__ == "__main__":
    sys.exit(main())
