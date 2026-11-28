#!/usr/bin/env python3
"""回读校验：比对写入前后的飞书文档快照。

快照可以是 `lark-cli docs +fetch --detail with-ids` 的 JSON，也可以是纯 XML。

检查项：
- 标题编号是否连续（按 h1 → h2 → h3 的 seq-marker）
- 消失和新增的 block id
- 受保护的小节是否一字未动
- 片段里的每个段落、列表项、代码块是否都在新文档里
- 指定表格的行数
- 画板 token 的增减

用法：
    verify_doc.py --old before.json --new after.json --snippets edit/ \\
        --protect "会上确认的情况" --expect-missing 96 --table "验收表=指标:10"
"""
import argparse
import copy
import glob
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

ID_RE = re.compile(r' id="doxcn[^"]*"')
LEVELS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}
TEXT_TAGS = ("p", "li", "h1", "h2", "h3", "h4", "pre")


def load(path):
    text = open(path, encoding="utf-8").read()
    if text.lstrip().startswith("{"):
        return json.loads(text)["data"]["document"]["content"]
    return text


def squash(el):
    """去掉所有空白后的文本，用来做宽松比对。"""
    return re.sub(r"\s+", "", "".join(el.itertext()))


def xml_of(el):
    el = copy.deepcopy(el)
    el.tail = None
    return ID_RE.sub("", ET.tostring(el, encoding="unicode"))


def squash_title(title):
    return re.sub(r"\s+", "", title)


def section(root, title):
    """从标题到下一个同级或更高级标题之前的块（去掉 id 后的 XML 列表）。找不到返回 None。"""
    kids = list(root)
    for i, el in enumerate(kids):
        if el.tag in LEVELS and squash(el) == squash_title(title):
            out, lv = [], LEVELS[el.tag]
            for nxt in kids[i + 1:]:
                if nxt.tag in LEVELS and LEVELS[nxt.tag] <= lv:
                    break
                out.append(xml_of(nxt))
            return out
    return None


def check_headings(root, fails):
    rows, counters = [], {}
    for el in root.iter():
        if el.tag not in LEVELS:
            continue
        lv, seq = LEVELS[el.tag], el.get("seq-marker") or ""
        seq = seq[:-1] if seq.endswith(".") else seq  # 一级标题的编号带尾点，如「1.」
        rows.append((seq, "".join(el.itertext()).strip()))
        if not seq:
            continue  # 不带编号的标题
        counters[lv] = counters.get(lv, 0) + 1
        for deeper in [k for k in counters if k > lv]:
            del counters[deeper]
        want = ".".join(str(counters.get(k, 0)) for k in range(1, lv + 1))
        if seq != want:
            fails.append(f"标题编号不连续：{el.tag}「{rows[-1][1]}」是 {seq}，应为 {want}")
    return rows


def check_snippets(snippet_dir, root, fails):
    present = {tag: {squash(el) for el in root.iter(tag)} for tag in TEXT_TAGS}
    for path in sorted(glob.glob(os.path.join(snippet_dir, "*.xml"))):
        try:
            snippet = ET.fromstring("<r>" + open(path, encoding="utf-8").read() + "</r>")
        except ET.ParseError as e:
            fails.append(f"片段不是良构的 XML：{path}（{e}）")
            continue
        for node in snippet.iter():
            if node.tag in TEXT_TAGS and squash(node) not in present[node.tag]:
                fails.append(f"片段内容不在新文档里：{os.path.basename(path)} <{node.tag}> {squash(node)[:40]}")


def check_tables(root, specs, fails):
    tables = [([el for el in t.iter("tr")], t) for t in root.iter("table")]
    for spec in specs:
        name, _, rest = spec.partition("=")
        keyword, _, want = rest.rpartition(":")
        hit = [rows for rows, _ in tables if rows and keyword in squash(rows[0])]
        if len(hit) != 1:
            fails.append(f"表格「{name}」按表头「{keyword}」匹配到 {len(hit)} 张，应恰好 1 张")
            continue
        n = len(hit[0])
        if n != int(want):
            fails.append(f"表格「{name}」有 {n} 行（含表头），期望 {want}")
        print(f"表格「{name}」：{n} 行（含表头）")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", required=True)
    ap.add_argument("--new", required=True)
    ap.add_argument("--snippets", help="片段目录，检查其中每个 *.xml 的内容都在新文档里")
    ap.add_argument("--protect", action="append", default=[], help="小节标题，要求一字未动；可重复")
    ap.add_argument("--expect-missing", type=int, help="期望消失的旧 block id 数量")
    ap.add_argument("--table", action="append", default=[], help="名称=表头关键词:期望行数(含表头)；可重复")
    ap.add_argument("--json", action="store_true", help="结果以 JSON 输出")
    a = ap.parse_args()

    old, new = load(a.old), load(a.new)
    try:
        ro, rn = ET.fromstring("<r>" + old + "</r>"), ET.fromstring("<r>" + new + "</r>")
    except ET.ParseError as e:
        sys.exit(f"快照不是良构的 XML：{e}")

    fails = []
    heads = check_headings(rn, fails)

    oi = set(re.findall(r'id="(doxcn[^"]+)"', old))
    ni = set(re.findall(r'id="(doxcn[^"]+)"', new))
    missing, added = oi - ni, ni - oi
    if a.expect_missing is not None and len(missing) != a.expect_missing:
        fails.append(f"消失的旧 id 有 {len(missing)} 个，期望 {a.expect_missing}")

    for title in a.protect:
        so, sn = section(ro, title), section(rn, title)
        if so is None or sn is None:
            fails.append(f"找不到小节：{title}")
        elif so != sn:
            diff = sum(1 for x, y in zip(so, sn) if x != y) + abs(len(so) - len(sn))
            fails.append(f"受保护的小节被改动：「{title}」（{diff} 处不同）")

    if a.snippets:
        check_snippets(a.snippets, rn, fails)
    if a.table:
        check_tables(rn, a.table, fails)

    to = re.findall(r'<whiteboard[^>]*token="([^"]+)"', old)
    tn = re.findall(r'<whiteboard[^>]*token="([^"]+)"', new)
    lost_boards = [t for t in to if t not in tn]

    if a.json:
        print(json.dumps({"ok": not fails, "headings": heads, "missing_ids": len(missing),
                          "added_ids": len(added), "lost_boards": lost_boards, "fails": fails},
                         ensure_ascii=False, indent=1))
        return 0 if not fails else 1

    print(f"标题 {len(heads)} 个")
    for seq, text in heads:
        print(f"  {seq:6s} {text}")
    print(f"消失的旧 id：{len(missing)}    新增的 id：{len(added)}")
    print(f"画板：旧 {len(to)} 张，新 {len(tn)} 张，新增 {len(tn) - len(to)} 张，丢失 {len(lost_boards)} 张")
    if fails:
        print(f"\n失败 {len(fails)} 项：")
        for f in fails:
            print("  -", f)
        return 1
    print("\n全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
