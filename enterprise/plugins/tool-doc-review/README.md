# tool-doc-review

文档校对工具通用封装模板

**插件类型**: `tool-pack`

## 协议

详见 `enterprise/docs/plugin-protocol/`

## 本地 CLI（验收最小实现）

```bash
python3 enterprise/plugins/tool-doc-review/doc_review_cli.py \
  --input /path/to/input.txt \
  --rules /path/to/rules.json \
  --output /path/to/report.json
```
