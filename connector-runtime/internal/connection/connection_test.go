package connection

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenticx/connector-runtime/internal/secret"
)

func openTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	c, err := secret.NewCipher(secret.GenerateKey())
	if err != nil {
		t.Fatal(err)
	}
	s, err := Open(dir, c)
	if err != nil {
		t.Fatal(err)
	}
	return s, dir
}

func TestCreateAndReveal(t *testing.T) {
	s, dir := openTestStore(t)
	p, err := s.Create("httpbin", "我的连接", "api_key", []string{"echo"}, Secret{APIKey: "sk-plaintext-key"})
	if err != nil {
		t.Fatal(err)
	}
	if p.ID == "" || !strings.HasPrefix(p.ID, "conn-") || p.ConnectorID != "httpbin" {
		t.Fatalf("投影字段不符: %+v", p)
	}
	// 投影不得含凭据材料
	raw, _ := json.Marshal(p)
	if strings.Contains(string(raw), "sk-plaintext-key") || strings.Contains(string(raw), "encryptedSecret") {
		t.Fatalf("投影泄漏凭据: %s", raw)
	}
	// 落盘文件不得含明文凭据
	fileB, err := os.ReadFile(filepath.Join(dir, "connections.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(fileB), "sk-plaintext-key") {
		t.Fatalf("存储文件泄漏明文凭据")
	}
	// Reveal 解密一致
	sec, err := s.Reveal(p.ID)
	if err != nil || sec.APIKey != "sk-plaintext-key" {
		t.Fatalf("Reveal 失败: %+v %v", sec, err)
	}
}

func TestPersistenceAcrossReopen(t *testing.T) {
	s, dir := openTestStore(t)
	p, err := s.Create("httpbin", "conn1", "api_key", nil, Secret{APIKey: "sk-plaintext-key"})
	if err != nil {
		t.Fatal(err)
	}
	// 同目录 + 同密钥重开（同包测试可直接访问私有字段）
	s2, err := Open(dir, s.cipher)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := s2.Get(p.ID)
	if !ok || got.Name != "conn1" {
		t.Fatalf("重开后连接丢失: %+v", got)
	}
	sec, err := s2.Reveal(p.ID)
	if err != nil || sec.APIKey != "sk-plaintext-key" {
		t.Fatalf("重开后解密失败: %+v %v", sec, err)
	}
}

func TestDelete(t *testing.T) {
	s, _ := openTestStore(t)
	p, _ := s.Create("httpbin", "conn1", "api_key", nil, Secret{APIKey: "k"})
	if !s.Delete(p.ID) {
		t.Fatal("删除已存在连接应返回 true")
	}
	if s.Delete(p.ID) {
		t.Fatal("删除不存在连接应返回 false")
	}
	if _, ok := s.Get(p.ID); ok {
		t.Fatal("删除后仍可查询")
	}
	if len(s.List()) != 0 {
		t.Fatal("列表应为空")
	}
}

func TestListSortedAndProjectionOnly(t *testing.T) {
	s, _ := openTestStore(t)
	for _, name := range []string{"c3", "c1", "c2"} {
		if _, err := s.Create("httpbin", name, "api_key", nil, Secret{APIKey: "k-" + name}); err != nil {
			t.Fatal(err)
		}
	}
	list := s.List()
	if len(list) != 3 {
		t.Fatalf("应有 3 条: %d", len(list))
	}
	for i := 1; i < len(list); i++ {
		if list[i].CreatedAt.Before(list[i-1].CreatedAt) {
			t.Fatal("列表应按创建时间升序")
		}
	}
	for _, p := range list {
		if p.GrantedScopes == nil && p.ID == "" {
			t.Fatal("投影字段缺失")
		}
	}
}

func TestCreateValidation(t *testing.T) {
	s, _ := openTestStore(t)
	if _, err := s.Create("", "n", "api_key", nil, Secret{}); err == nil {
		t.Fatal("空 connectorID 应报错")
	}
	if _, err := s.Create("x", " ", "api_key", nil, Secret{}); err == nil {
		t.Fatal("空 name 应报错")
	}
}
