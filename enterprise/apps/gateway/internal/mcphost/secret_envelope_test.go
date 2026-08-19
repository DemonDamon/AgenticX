package mcphost

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// 跨语言信封的那一份样本：admin-console 的 TS 实现实际产出的密文，Go 这边必须解得开。
//
// 样本存在 testdata/cross_language_envelope.json，**TS 那边的测试读的是同一个文件**
// （packages/iam-core/src/provider-api-key-crypto.test.ts）。以前它是这个文件里的一个
// 常量，只有 Go 这一侧盯着：TS 改了信封格式，这个常量就是一段历史数据，Go 照样解得开，
// 测试照样绿，最早的症状要等到生产上 MCP 连不上上游。现在两边读同一份，谁走偏谁自己先红。
type crossLanguageEnvelope struct {
	Secret     string `json:"secret"`
	Plaintext  string `json:"plaintext"`
	Ciphertext string `json:"ciphertext"`
}

var (
	envelopeOnce   sync.Once
	envelopeSample crossLanguageEnvelope
	envelopeErr    error
)

func loadCrossLanguageEnvelope(t *testing.T) crossLanguageEnvelope {
	t.Helper()
	envelopeOnce.Do(func() {
		raw, err := os.ReadFile(filepath.Join("testdata", "cross_language_envelope.json"))
		if err != nil {
			envelopeErr = err
			return
		}
		envelopeErr = json.Unmarshal(raw, &envelopeSample)
	})
	if envelopeErr != nil {
		t.Fatalf("read cross-language envelope fixture: %v", envelopeErr)
	}
	return envelopeSample
}

func TestDecryptSecretEnvelopeReadsCiphertextProducedByAdminConsole(t *testing.T) {
	sample := loadCrossLanguageEnvelope(t)
	t.Setenv("AGX_PROVIDER_SECRET_KEY", sample.Secret)

	got, err := decryptSecretEnvelope(sample.Ciphertext)
	if err != nil {
		t.Fatalf("decrypt TS-produced ciphertext: %v", err)
	}
	if got != sample.Plaintext {
		t.Fatalf("plaintext mismatch:\n got: %s\nwant: %s", got, sample.Plaintext)
	}
}

func TestDecodeBackendConfigUnwrapsEncryptedRow(t *testing.T) {
	sample := loadCrossLanguageEnvelope(t)
	t.Setenv("AGX_PROVIDER_SECRET_KEY", sample.Secret)

	row, err := json.Marshal(map[string]any{backendConfigCipherKey: sample.Ciphertext})
	if err != nil {
		t.Fatalf("marshal row: %v", err)
	}
	cfg := decodeBackendConfig(row)
	if cfg["api_key"] != "sk-market-data-123" {
		t.Fatalf("api_key not decrypted, got %#v", cfg["api_key"])
	}
	if cfg["base_url"] != "https://data.example.com" {
		t.Fatalf("base_url not decrypted, got %#v", cfg["base_url"])
	}
	if _, leaked := cfg[backendConfigCipherKey]; leaked {
		t.Fatalf("cipher envelope leaked into the decoded config")
	}
}

func TestDecodeBackendConfigPassesThroughLegacyPlaintextRows(t *testing.T) {
	// 加密上线前写入的行没有信封键，必须继续可用，否则升级即断连。
	row := []byte(`{"base_url":"https://legacy.example.com","api_key":"plain-key"}`)
	cfg := decodeBackendConfig(row)
	if cfg["api_key"] != "plain-key" {
		t.Fatalf("legacy row not readable, got %#v", cfg)
	}
}

func TestDecodeBackendConfigYieldsNothingWhenTheKeyIsWrong(t *testing.T) {
	// 解不开时宁可给空配置让后端构造失败，也不要带着半份配置去连上游。
	sample := loadCrossLanguageEnvelope(t)
	t.Setenv("AGX_PROVIDER_SECRET_KEY", "a-different-secret")

	row, err := json.Marshal(map[string]any{backendConfigCipherKey: sample.Ciphertext})
	if err != nil {
		t.Fatalf("marshal row: %v", err)
	}
	if cfg := decodeBackendConfig(row); len(cfg) != 0 {
		t.Fatalf("expected an empty config on undecryptable row, got %#v", cfg)
	}
}

func TestDecryptSecretEnvelopeRejectsMalformedInput(t *testing.T) {
	t.Setenv("AGX_PROVIDER_SECRET_KEY", loadCrossLanguageEnvelope(t).Secret)

	for _, bad := range []string{
		"",
		"   ",
		"plaintext-not-an-envelope",
		"agx:gcm1:only-one-part",
		"agx:gcm1:a.b",
		"agx:gcm1:!!!.!!!.!!!",
	} {
		if _, err := decryptSecretEnvelope(bad); err == nil {
			t.Fatalf("expected an error for %q", bad)
		}
	}
}
