#!/usr/bin/env bash
# 渲染 SVG 画板并做几何检查（文字溢出、节点重叠、文字遮挡）。
# 用法：bash wb.sh path/to/diagram.svg
# 通过时退出码为 0，并在同目录生成同名 .png。检查通过不等于画面对，仍然要看 PNG。
set -euo pipefail

svg="${1:?用法: bash wb.sh diagram.svg}"
png="${svg%.svg}.png"
cli="@larksuite/whiteboard-cli@^0.2.13"

npx -y "$cli" -i "$svg" -o "$png" -f svg > /dev/null
npx -y "$cli" -i "$svg" -f svg --check | python3 -c '
import json, sys
d = json.load(sys.stdin)
check = d.get("data", {}).get("check") or {}
print("errors", check.get("errors"), "warnings", check.get("warnings"), json.dumps(check.get("summary"), ensure_ascii=False))
for issue in (check.get("issues") or [])[:20]:
    print(" ", json.dumps(issue, ensure_ascii=False))
sys.exit(0 if check.get("errors") == 0 and check.get("warnings") == 0 else 1)
'
echo "预览：$png"
