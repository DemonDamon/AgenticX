# 决策头基线报告（test 切分）

- scorer: `startlux:StartLux-Decision-0.8B-Q8_0:systemone`
- records: 20  questions: 20  evaluated: 20  temperature: 20.0

| decision_type | n | top1 | ECE | ECE(T) |
|---|---|---|---|---|
| tool_selection | 20 | 0.45 | 0.2953 | 0.0873 |

**overall**: top1=0.45 ECE=0.2953 ECE(T)=0.0873

skipped: {'no_probs': 0, 'bad_len': 0, 'no_gold': 0, 'gold_off_vocab': 0}
