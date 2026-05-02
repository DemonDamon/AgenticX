# tool-watermark

水印工具通用封装模板

**插件类型**: `tool-pack`

## 协议

详见 `enterprise/docs/plugin-protocol/`

## 本地 CLI（验收最小实现）

```bash
python3 enterprise/plugins/tool-watermark/pdf_watermark_cli.py \
  --input /path/to/in.pdf \
  --output /path/to/out.pdf \
  --text "HECHUANG-CONFIDENTIAL"
```
