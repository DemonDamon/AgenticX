package gatewayinternal

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSecretFromEnvPrefersBareVariable(t *testing.T) {
	ResetSecretCacheForTests()
	path := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(path, []byte("from-file"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "from-env")
	t.Setenv("GATEWAY_INTERNAL_TOKEN_FILE", path)

	if got := SecretFromEnv("GATEWAY_INTERNAL_TOKEN"); got != "from-env" {
		t.Fatalf("want from-env, got %q", got)
	}
}

func TestSecretFromEnvReadsFileWhenBareUnset(t *testing.T) {
	ResetSecretCacheForTests()
	path := filepath.Join(t.TempDir(), "token")
	// bootstrap.sh 用 `random_hex 16 > file` 生成，末尾必然带换行。
	if err := os.WriteFile(path, []byte("deadbeef\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "")
	t.Setenv("GATEWAY_INTERNAL_TOKEN_FILE", path)

	if got := SecretFromEnv("GATEWAY_INTERNAL_TOKEN"); got != "deadbeef" {
		t.Fatalf("want deadbeef, got %q", got)
	}
}

func TestSecretFromEnvEmptyWhenNeitherConfigured(t *testing.T) {
	ResetSecretCacheForTests()
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "")
	t.Setenv("GATEWAY_INTERNAL_TOKEN_FILE", "")

	if got := SecretFromEnv("GATEWAY_INTERNAL_TOKEN"); got != "" {
		t.Fatalf("want empty, got %q", got)
	}
}

func TestSecretFromEnvRereadsWhenPathChanges(t *testing.T) {
	// 缓存按路径失效，否则同进程内换过配置的调用会拿到上一份密钥。
	ResetSecretCacheForTests()
	dir := t.TempDir()
	first := filepath.Join(dir, "a")
	second := filepath.Join(dir, "b")
	if err := os.WriteFile(first, []byte("aaa"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(second, []byte("bbb"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "")

	t.Setenv("GATEWAY_INTERNAL_TOKEN_FILE", first)
	if got := SecretFromEnv("GATEWAY_INTERNAL_TOKEN"); got != "aaa" {
		t.Fatalf("want aaa, got %q", got)
	}
	t.Setenv("GATEWAY_INTERNAL_TOKEN_FILE", second)
	if got := SecretFromEnv("GATEWAY_INTERNAL_TOKEN"); got != "bbb" {
		t.Fatalf("want bbb, got %q", got)
	}
}

func TestSecretFromEnvMissingFileIsEmptyNotPanic(t *testing.T) {
	ResetSecretCacheForTests()
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "")
	t.Setenv("GATEWAY_INTERNAL_TOKEN_FILE", filepath.Join(t.TempDir(), "missing"))

	if got := SecretFromEnv("GATEWAY_INTERNAL_TOKEN"); got != "" {
		t.Fatalf("want empty, got %q", got)
	}
}
