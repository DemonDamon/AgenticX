package mcphost

import (
	"encoding/json"
	"testing"
)

// 由 admin-console 的 TS 实现（provider-api-key-crypto，AGX_PROVIDER_SECRET_KEY=
// test-provider-secret）实际产出的密文。两边信封一旦走偏，这个用例先红——
// 否则最早的症状会是生产上 MCP 连不上上游，而且看不出是解密问题。
const (
	tsProducedCipher = "agx:gcm1:qw3aCpZkf5i1NmKI.aG5X0kswkVOMS49UZBycXpmGPgmSefTTodSOXO9uAWlgGWl5XpeLvz1Eo3jJr3mUcemHkQIKaMNMTulLJTWIWnXk_rh7t7tsduu80bkYcMKYRvJR_oYgeqcK-AOkhSXt.Sru95VcTtvmvZm7FOG2QZA"
	tsProducedPlain  = `{"base_url":"https://data.example.com","api_key":"sk-market-data-123","headers":{"X-Seat":"42"}}`
)

func TestDecryptSecretEnvelopeReadsCiphertextProducedByAdminConsole(t *testing.T) {
	t.Setenv("AGX_PROVIDER_SECRET_KEY", "test-provider-secret")

	got, err := decryptSecretEnvelope(tsProducedCipher)
	if err != nil {
		t.Fatalf("decrypt TS-produced ciphertext: %v", err)
	}
	if got != tsProducedPlain {
		t.Fatalf("plaintext mismatch:\n got: %s\nwant: %s", got, tsProducedPlain)
	}
}

func TestDecodeBackendConfigUnwrapsEncryptedRow(t *testing.T) {
	t.Setenv("AGX_PROVIDER_SECRET_KEY", "test-provider-secret")

	row, err := json.Marshal(map[string]any{backendConfigCipherKey: tsProducedCipher})
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
	t.Setenv("AGX_PROVIDER_SECRET_KEY", "a-different-secret")

	row, err := json.Marshal(map[string]any{backendConfigCipherKey: tsProducedCipher})
	if err != nil {
		t.Fatalf("marshal row: %v", err)
	}
	if cfg := decodeBackendConfig(row); len(cfg) != 0 {
		t.Fatalf("expected an empty config on undecryptable row, got %#v", cfg)
	}
}

func TestDecryptSecretEnvelopeRejectsMalformedInput(t *testing.T) {
	t.Setenv("AGX_PROVIDER_SECRET_KEY", "test-provider-secret")

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
