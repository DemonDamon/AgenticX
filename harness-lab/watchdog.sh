#!/bin/zsh
# 看门狗：每 5 分钟检查 run_full 循环，死了就拉活（防止 nohup 进程被沙箱会话回收）
cd /Users/damonli/myWork/AgenticX/harness-lab
while true; do
    pgrep -f "run_full.py dsh" > /dev/null || { nohup python3 run_full.py dsh < /dev/null >> /tmp/dsh2-continue.log 2>&1 & print -u2 "[$(date '+%H:%M')] 重启 dsh" }
    pgrep -f "run_full.py agenticx" > /dev/null || { nohup python3 run_full.py agenticx < /dev/null >> /tmp/agx-continue.log 2>&1 & print -u2 "[$(date '+%H:%M')] 重启 agenticx" }
    pgrep -f "run_full.py hermes" > /dev/null || { nohup python3 run_full.py hermes < /dev/null >> /tmp/hermes-continue.log 2>&1 & print -u2 "[$(date '+%H:%M')] 重启 hermes" }
    sleep 300
done
