#!/bin/bash
# 验证 harbor 补丁生成的完整命令语法 + sed 替换正确性
CMD='if ! timeout 25 apt-get update -o Acquire::Retries=1 >/dev/null 2>&1; then sed -i.bak -E '"'"'s@//(archive|security)\.ubuntu\.com@//mirrors.aliyun.com@g'"'"' /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true; apt-get update; else true; fi && apt-get update && apt-get install -y curl'

bash -n -c "$CMD" && echo "SYNTAX OK"
echo 'deb http://archive.ubuntu.com/ubuntu noble main' | sed -E 's@//(archive|security)\.ubuntu\.com@//mirrors.aliyun.com@g'
echo 'deb http://security.ubuntu.com/ubuntu noble-security main' | sed -E 's@//(archive|security)\.ubuntu\.com@//mirrors.aliyun.com@g'
