# tool-doc-review

Document review tool for enterprise acceptance with keyword/regex rules and deterministic format checks.

**Plugin type**: `tool-pack`

## Install

```bash
cd enterprise/plugins/tool-doc-review
pip install -r requirements.txt
```

## Keyword / regex review (txt)

```bash
python3 doc_review_cli.py \
  --input /path/to/input.txt \
  --rules /path/to/rules.json \
  --output /path/to/report.json
```

## Format checks (docx / pdf)

```bash
python3 doc_review_cli.py \
  --input /path/to/sample.docx \
  --format-check \
  --output /path/to/report.json
```

Supported format checks:

- Heading hierarchy jumps
- Figure/table numbering continuity
- Font name/size consistency (docx; PDF best-effort for numbering only)
- Paragraph spacing consistency (docx)

## Miss / false-alarm evaluation

```bash
python3 eval_metrics.py \
  --expected /path/to/labels.json \
  --report /path/to/report.json \
  --output /path/to/metrics.json
```

Label format:

```json
{
  "expected": [
    {"category": "二类", "locator": "图2", "kind": "缺号"}
  ]
}
```

## Tests

```bash
pytest tests/ -q
```
