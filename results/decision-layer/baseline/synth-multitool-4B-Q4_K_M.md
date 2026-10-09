# 决策头基线报告（test 切分）

- scorer: `startlux:StartLux-Decision-4B-Q4_K_M:systemone`
- records: 20  questions: 20  evaluated: 20  temperature: 1.4137

| decision_type | n | top1 | ECE | ECE(T) |
|---|---|---|---|---|
| tool_selection | 20 | 0.45 | 0.3166 | 0.2894 |

**overall**: top1=0.45 ECE=0.3166 ECE(T)=0.2894

skipped: {'no_probs': 0, 'bad_len': 0, 'no_gold': 0, 'gold_off_vocab': 0}
