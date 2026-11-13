package server

// SP6 red-team-drill helpers：演练测试专用小工具（均为合成攻击素材，无真实凭据）。

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/golang-jwt/jwt/v5"
)

func redTeamDrillReportPath() string {
	return strings.TrimSpace(os.Getenv("RED_TEAM_DRILL_REPORT"))
}

func appendDrillJSONL(t *testing.T, row map[string]any) {
	t.Helper()
	path := redTeamDrillReportPath()
	if path == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := json.NewEncoder(f).Encode(row); err != nil {
		t.Fatal(err)
	}
}

func redTeamRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

// redTeamTamperJWTTenant 篡改 JWT payload 的 tenantId 字段但不重新签名
// （攻击者无签名私钥的现实场景）。
func redTeamTamperJWTTenant(t *testing.T, signed string) string {
	t.Helper()
	parts := strings.Split(signed, ".")
	if len(parts) != 3 {
		t.Fatal("not a JWS compact token")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims map[string]any
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatal(err)
	}
	claims["tenantId"] = "tenant-b" // 冒充他租户
	forged, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	parts[1] = base64.RawURLEncoding.EncodeToString(forged)
	return strings.Join(parts, ".")
}

// redTeamTamperAuditLine 在审计目录第一个 jsonl 文件里做字符串替换（行内篡改）。
func redTeamTamperAuditLine(t *testing.T, auditDir, old, new string) error {
	t.Helper()
	entries, err := os.ReadDir(auditDir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		path := filepath.Join(auditDir, e.Name())
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		text := string(raw)
		if !strings.Contains(text, old) {
			continue
		}
		text = strings.Replace(text, old, new, 1)
		return os.WriteFile(path, []byte(text), 0o644)
	}
	return os.ErrNotExist
}

func writeRedTeamBudget(t *testing.T, dir, body string) string {
	t.Helper()
	path := filepath.Join(dir, "budgets.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// redTeamModerationProvider 模拟第三方内容安全 API（真实外呼契约：HTTP JSON）。
func redTeamModerationProvider(t *testing.T, verdictJSON string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(verdictJSON))
	}))
}

func routingDecisionDefault() routing.Decision {
	return routing.Decision{Provider: "openai", Route: "default"}
}

// 保留 JWT claims 解析路径的编译期依赖（helpers 与用例共享签名工具）。
var _ = jwt.SigningMethodRS256
