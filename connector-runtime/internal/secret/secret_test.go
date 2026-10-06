package secret

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEncryptDecryptRoundTrip(t *testing.T) {
	c, err := NewCipher(GenerateKey())
	if err != nil {
		t.Fatal(err)
	}
	for _, pt := range []string{"", "sk-plain-secret", strings.Repeat("x", 10000), "中文凭据"} {
		b, err := c.Encrypt([]byte(pt))
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(b, []byte(pt)) && pt != "" {
			t.Fatalf("密文包含明文: %q", pt)
		}
		got, err := c.Decrypt(b)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != pt {
			t.Fatalf("往返不一致: %q != %q", got, pt)
		}
	}
}

func TestDecryptWithWrongKeyFails(t *testing.T) {
	c1, _ := NewCipher(GenerateKey())
	c2, _ := NewCipher(GenerateKey())
	b, err := c1.Encrypt([]byte("sk-plain-secret"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c2.Decrypt(b); err == nil {
		t.Fatal("错误密钥解密应失败")
	}
	// 篡改密文应失败
	b[len(b)-1] ^= 0xFF
	if _, err := c1.Decrypt(b); err == nil {
		t.Fatal("篡改密文解密应失败")
	}
}

func TestNewCipherKeyLength(t *testing.T) {
	for _, n := range []int{0, 16, 31, 33, 64} {
		if _, err := NewCipher(make([]byte, n)); err == nil {
			t.Fatalf("长度 %d 应被拒绝", n)
		}
	}
}

func TestStringHelpers(t *testing.T) {
	c, _ := NewCipher(GenerateKey())
	enc, err := c.EncryptString("sk-plain-secret")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(enc, "sk-plain-secret") {
		t.Fatal("base64 密文泄漏明文")
	}
	got, err := c.DecryptString(enc)
	if err != nil || got != "sk-plain-secret" {
		t.Fatalf("字符串往返失败: %q %v", got, err)
	}
}

func TestLoadOrGenerateKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sub", "master.key")
	k1, err := LoadOrGenerateKey(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(k1) != KeySize {
		t.Fatalf("密钥长度 %d", len(k1))
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("密钥文件权限 %o，应为 0600", info.Mode().Perm())
	}
	k2, err := LoadOrGenerateKey(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(k1, k2) {
		t.Fatal("重复加载应得到同一密钥")
	}
	if err := os.WriteFile(path, make([]byte, 10), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrGenerateKey(path); err == nil {
		t.Fatal("长度异常的密钥文件应报错")
	}
}
