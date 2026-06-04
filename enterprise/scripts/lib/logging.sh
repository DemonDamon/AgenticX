#!/usr/bin/env bash
# 关键 CLI 步骤（db:migrate 等）stdout/stderr 同步落盘，便于排障与客户回传。
# 用法（在 enterprise 脚本内）：
#   source "$SCRIPT_DIR/lib/logging.sh"
#   LOG_FILE="$(agx_new_log_file db-migrate)"
#   agx_run_with_log "db:migrate" "$LOG_FILE" pnpm --filter @agenticx/db-schema db:migrate

agx_log_dir() {
  local base="${ENTERPRISE_DIR:-}"
  if [ -z "$base" ]; then
    base="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  fi
  printf '%s/.runtime/logs' "$base"
}

agx_init_log_dir() {
  mkdir -p "$(agx_log_dir)"
}

# 生成带时间戳的日志路径，如 db-migrate-20260604-113045.log
agx_new_log_file() {
  local prefix="${1:-step}"
  agx_init_log_dir
  printf '%s/%s-%s.log' "$(agx_log_dir)" "$prefix" "$(date +%Y%m%d-%H%M%S)"
}

# agx_run_with_log STEP_NAME LOG_FILE command [args...]
# 终端仍可见输出；失败时在 stderr 打印日志路径。
agx_run_with_log() {
  local step="$1"
  local log_file="$2"
  shift 2

  agx_init_log_dir
  {
    echo "=== $step ==="
    echo "started: $(date '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null || date)"
    echo "cwd: $(pwd)"
    printf 'command:'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    echo
    echo "---"
  } | tee "$log_file"

  # 注意：管道退出码默认取最后一个命令(tee)，必须用 PIPESTATUS 取真实命令退出码，
  # 否则失败会被 tee 的成功掩盖（与"暴露错误"目标相反）。
  "$@" 2>&1 | tee -a "$log_file"
  local ec="${PIPESTATUS[0]}"

  if [ "$ec" -eq 0 ]; then
    {
      echo "=== $step OK ==="
      echo "finished: $(date '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null || date)"
      echo "log: $log_file"
    } | tee -a "$log_file"
    return 0
  fi

  {
    echo "=== $step FAILED (exit $ec) ==="
    echo "finished: $(date '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null || date)"
    echo "log: $log_file"
  } | tee -a "$log_file" >&2
  printf '[log] %s failed — full output: %s\n' "$step" "$log_file" >&2
  return "$ec"
}
