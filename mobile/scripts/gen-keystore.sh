#!/usr/bin/env bash
#
# ============================================================================
#  Near Mobile — Android 上传密钥（keystore）生成脚本
# ============================================================================
#
#  ⚠️⚠️⚠️  严重警告  ⚠️⚠️⚠️
#
#  这个 keystore 是 Android APK 的签名身份。一旦用它发布了任何一版 APK：
#    - 丢失 keystore = 永远无法再给同一个应用发布更新（用户只能卸载重装）
#    - 忘记密码     = 等同丢失
#    - 泄漏给他人   = 他人可以冒充你的应用签名发假包，必须立即停止使用并
#                    换新 keystore + 新 applicationId 重新发布
#
#  生成后必须立即备份到安全位置（密码管理器附件 + 离线存储）。
#  本仓库 .gitignore 已排除 *.keystore / keystore.properties，切勿强行提交。
#
#  参数（均有默认值，可按需覆盖）：
#    --out   <路径>   输出文件，默认 mobile/android-upload.keystore
#    --alias <别名>   密钥别名，默认 nearx-mobile
#    --dname <DN>     证书主题，默认 "CN=Near Mobile, OU=Mobile, O=NearX, C=CN"
#
#  算法：RSA 2048 / PKCS12 / 有效期 10000 天（约 27 年）
#  密码：交互式输入两次（不回显、不落 shell 历史）；PKCS12 的 storepass
#        与 keypass 必须一致，脚本只问一次。
#
#  依赖：JDK 的 keytool（自动探测 JAVA_HOME → Homebrew openjdk → PATH）
#
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

OUT="${MOBILE_DIR}/android-upload.keystore"
ALIAS="nearx-mobile"
DNAME="CN=Near Mobile, OU=Mobile, O=NearX, C=CN"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      OUT="$2"
      shift 2
      ;;
    --alias)
      ALIAS="$2"
      shift 2
      ;;
    --dname)
      DNAME="$2"
      shift 2
      ;;
    *)
      echo "未知参数: $1" >&2
      echo "用法: $0 [--out <路径>] [--alias <别名>] [--dname <DN>]" >&2
      exit 1
      ;;
  esac
done

# ---- 定位可用的 keytool（macOS 的 /usr/bin/keytool 是无 Java 的 stub）----
find_keytool() {
  local candidate
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/keytool" ]]; then
    echo "${JAVA_HOME}/bin/keytool"
    return 0
  fi
  for candidate in /opt/homebrew/opt/openjdk*/bin/keytool /usr/local/opt/openjdk*/bin/keytool; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  if command -v keytool >/dev/null 2>&1 && keytool -help >/dev/null 2>&1; then
    command -v keytool
    return 0
  fi
  return 1
}

if ! KEYTOOL="$(find_keytool)"; then
  echo "错误：找不到可用的 keytool（需要 JDK）。" >&2
  echo "安装：brew install openjdk@17 && export JAVA_HOME=\$(/usr/libexec/java_home -v 17)" >&2
  exit 1
fi

if [[ -e "$OUT" ]]; then
  echo "错误：输出文件已存在：$OUT" >&2
  echo "（覆盖旧 keystore 会导致已发布 APK 无法更新；如确认废弃请手动删除后重跑）" >&2
  exit 1
fi

# ---- 交互式读密码（read -s 不回显；PKCS12 要求 storepass == keypass）----
read -r -s -p "设置 keystore 密码（≥6 位，输入不回显）: " PASS1
echo
read -r -s -p "再输入一次确认: " PASS2
echo
if [[ "$PASS1" != "$PASS2" ]]; then
  echo "错误：两次输入不一致。" >&2
  exit 1
fi
if [[ "${#PASS1}" -lt 6 ]]; then
  echo "错误：密码长度不足 6 位。" >&2
  exit 1
fi

# ---- 生成 ----
echo "生成中：$OUT"
"$KEYTOOL" -genkeypair -v \
  -storetype PKCS12 \
  -keystore "$OUT" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$PASS1" \
  -dname "$DNAME"

chmod 600 "$OUT"

# ---- 自检：能列出条目才算成功 ----
"$KEYTOOL" -list -keystore "$OUT" -storepass "$PASS1" >/dev/null

echo
echo "✅ 生成成功：${OUT}（alias: ${ALIAS}，RSA 2048 / PKCS12 / 10000 天）"
echo
echo "下一步："
echo "  1. 立即备份 keystore + 密码到密码管理器 / 离线存储（丢失无法补发更新！）"
echo "  2. EAS 构建时选择「上传本地 keystore」或使用 eas credentials 配置"
echo "  3. 安装到真机见 RELEASE.md「Android」一节"
