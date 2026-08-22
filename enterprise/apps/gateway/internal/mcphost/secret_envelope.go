package mcphost

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
)

// backend_config 里的凭据由 admin-console 加密后入库，网关这里解开。
//
// 信封与 TS 侧 provider-api-key-crypto 完全同构（AES-256-GCM，key 取
// sha256(AGX_PROVIDER_SECRET_KEY)），两边共用同一份密钥材料；
// cross_language_test.go 用 TS 产出的密文钉住这个兼容性。
const (
	secretEnvelopePrefix = "agx:gcm1:"
	// 密文信封在 backend_config JSON 里的键名。存在该键即表示整份配置已加密。
	backendConfigCipherKey = "__agx_cipher"
	devSecretMaterial      = "dev-agx-provider-secret-insecure"
)

var errSecretEnvelope = errors.New("mcp:backend_config_undecryptable")

func secretKeyMaterial() []byte {
	configured := strings.TrimSpace(os.Getenv("AGX_PROVIDER_SECRET_KEY"))
	if configured == "" {
		// 与 TS 侧的开发态回退一致；生产环境必须配置该变量，否则解密会直接失败，
		// 而不是拿一个可预测的密钥继续跑。
		sum := sha256.Sum256([]byte(devSecretMaterial))
		return sum[:]
	}
	sum := sha256.Sum256([]byte(configured))
	return sum[:]
}

// decryptSecretEnvelope 解开 `agx:gcm1:<iv>.<enc>.<tag>`（base64url，无 padding）。
func decryptSecretEnvelope(ciphertext string) (string, error) {
	raw := strings.TrimSpace(ciphertext)
	if raw == "" {
		return "", errSecretEnvelope
	}
	if !strings.HasPrefix(raw, secretEnvelopePrefix) {
		return "", errSecretEnvelope
	}
	parts := strings.Split(strings.TrimPrefix(raw, secretEnvelopePrefix), ".")
	if len(parts) != 3 {
		return "", errSecretEnvelope
	}
	iv, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", errSecretEnvelope
	}
	enc, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", errSecretEnvelope
	}
	tag, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", errSecretEnvelope
	}
	block, err := aes.NewCipher(secretKeyMaterial())
	if err != nil {
		return "", errSecretEnvelope
	}
	aead, err := cipher.NewGCMWithNonceSize(block, len(iv))
	if err != nil {
		return "", errSecretEnvelope
	}
	// Node 的 getAuthTag() 是分开返回的，这里拼回 GCM 期望的 ciphertext||tag。
	plain, err := aead.Open(nil, iv, append(append([]byte{}, enc...), tag...), nil)
	if err != nil {
		return "", errSecretEnvelope
	}
	return string(plain), nil
}

// decodeBackendConfig 解析 backend_config：已加密的解开，历史明文行原样返回。
//
// 解密失败返回空 map 而不是明文残留——凭据解不开时让后端构造失败，
// 好过带着半份配置去连上游。
func decodeBackendConfig(raw []byte) map[string]any {
	decoded := decodeJSONMap(raw)
	cipherText, encrypted := decoded[backendConfigCipherKey].(string)
	if !encrypted {
		return decoded
	}
	plain, err := decryptSecretEnvelope(cipherText)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(plain), &out); err != nil || out == nil {
		return map[string]any{}
	}
	return out
}
