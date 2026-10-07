package connectorstore

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"

	connectorapi "github.com/agenticx/connector-runtime/api"
)

// setMasterKey 替换主密钥环境读取（测试结束后还原）。
func setMasterKey(t *testing.T, raw []byte) {
	t.Helper()
	orig := envMasterKey
	encoded := ""
	if raw != nil {
		encoded = base64.StdEncoding.EncodeToString(raw)
	}
	envMasterKey = func() string { return encoded }
	t.Cleanup(func() { envMasterKey = orig })
}

func TestCipherRoundtripFromEnvKey(t *testing.T) {
	setMasterKey(t, connectorapi.GenerateMasterKey())
	s := New(nil, nil)
	enc, err := s.encryptSecret(connectorapi.ConnectionSecret{APIKey: "sk-live-123"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(enc, "sk-live-123") {
		t.Fatalf("密文包含明文凭据: %s", enc)
	}
	c, err := s.cipher()
	if err != nil {
		t.Fatal(err)
	}
	sec, err := DecryptSecretString(c, enc)
	if err != nil || sec.APIKey != "sk-live-123" {
		t.Fatalf("加解密 roundtrip 失败: %+v %v", sec, err)
	}
}

func TestCipherMissingMasterKey(t *testing.T) {
	setMasterKey(t, nil)
	s := New(nil, nil)
	if _, err := s.cipher(); err == nil || !strings.Contains(err.Error(), MasterKeyEnv) {
		t.Fatalf("缺少主密钥应报错并提示环境变量 %s: %v", MasterKeyEnv, err)
	}
	if _, err := s.encryptSecret(connectorapi.ConnectionSecret{APIKey: "k"}); err == nil {
		t.Fatal("缺少主密钥时加密应失败")
	}
}

func TestCipherInvalidBase64(t *testing.T) {
	orig := envMasterKey
	envMasterKey = func() string { return "!!!not-base64!!!" }
	t.Cleanup(func() { envMasterKey = orig })
	s := New(nil, nil)
	if _, err := s.cipher(); err == nil || !strings.Contains(err.Error(), "解码失败") {
		t.Fatalf("非法 base64 主密钥应报解码错误: %v", err)
	}
}

func TestCipherWrongKeyLength(t *testing.T) {
	setMasterKey(t, make([]byte, 16)) // 16 字节 ≠ AES-256 要求的 32 字节
	s := New(nil, nil)
	if _, err := s.cipher(); err == nil {
		t.Fatal("非 32 字节主密钥应报错")
	}
}

func TestDecodeBase64Key(t *testing.T) {
	raw := []byte("0123456789abcdef0123456789abcdef")
	got, err := decodeBase64Key(base64.StdEncoding.EncodeToString(raw))
	if err != nil || len(got) != 32 {
		t.Fatalf("合法主密钥解码失败: %v", err)
	}
	if _, err := decodeBase64Key("####"); err == nil {
		t.Fatal("非法 base64 应报错")
	}
}

func TestNewConnectionIDFormat(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		id := newConnectionID()
		if !strings.HasPrefix(id, "conn-") || len(id) != len("conn-")+16 {
			t.Fatalf("id 格式不符: %s", id)
		}
		if seen[id] {
			t.Fatalf("id 重复: %s", id)
		}
		seen[id] = true
	}
}

func TestNilDatabaseGuards(t *testing.T) {
	s := New(nil, nil)
	ctx := context.Background()
	if _, err := s.ListDefinitions(ctx, "t"); err == nil {
		t.Fatal("nil db 时 ListDefinitions 应报错")
	}
	if err := s.UpsertDefinition(ctx, "t", nil); err == nil {
		t.Fatal("nil db 时 UpsertDefinition 应报错")
	}
	if _, err := s.DeleteDefinition(ctx, "t", "c"); err == nil {
		t.Fatal("nil db 时 DeleteDefinition 应报错")
	}
	if _, err := s.CreateConnection(ctx, "t", CreateConnectionInput{ConnectorID: "c", Name: "n"}); err == nil {
		t.Fatal("nil db 时 CreateConnection 应报错")
	}
	if err := s.RotateConnectionSecret(ctx, "t", "id", RotateConnectionInput{APIKey: "k"}); err == nil {
		t.Fatal("nil db 时 RotateConnectionSecret 应报错")
	}
	if _, err := s.RevokeConnection(ctx, "t", "id"); err == nil {
		t.Fatal("nil db 时 RevokeConnection 应报错")
	}
}

func TestDecodeScopesJSONNeverNil(t *testing.T) {
	if got := decodeScopesJSON(nil); got == nil {
		t.Fatal("nil raw 应返回空切片而非 nil")
	}
	if got := decodeScopesJSON([]byte("null")); got == nil {
		t.Fatal("JSON null 应返回空切片而非 nil")
	}
	if got := decodeScopesJSON([]byte("[]")); got == nil {
		t.Fatal("空数组应返回空切片而非 nil")
	}
	got := decodeScopesJSON([]byte(`["read"]`))
	if len(got) != 1 || got[0] != "read" {
		t.Fatalf("got %#v", got)
	}
}
