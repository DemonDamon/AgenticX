// Package secret 提供凭据静态加密：AES-256-GCM，密文布局 nonce || ciphertext。
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Cipher AES-GCM 加解密器。
type Cipher struct {
	gcm cipher.AEAD
}

// KeySize 主密钥长度（AES-256）。
const KeySize = 32

// NewCipher 用 32 字节主密钥构造。
func NewCipher(key []byte) (*Cipher, error) {
	if len(key) != KeySize {
		return nil, fmt.Errorf("主密钥长度须为 %d 字节，得到 %d", KeySize, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{gcm: gcm}, nil
}

// GenerateKey 生成随机主密钥。
func GenerateKey() []byte {
	key := make([]byte, KeySize)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		panic(err) // 系统熵源不可用属致命错误
	}
	return key
}

// LoadOrGenerateKey 加载主密钥文件；不存在则生成并以 0600 权限落盘。
func LoadOrGenerateKey(path string) ([]byte, error) {
	if b, err := os.ReadFile(path); err == nil {
		if len(b) != KeySize {
			return nil, fmt.Errorf("主密钥文件 %s 长度异常（%d 字节）", path, len(b))
		}
		return b, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	key := GenerateKey()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

// Encrypt 加密，返回 nonce || ciphertext。
func (c *Cipher) Encrypt(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return c.gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt 解密 nonce || ciphertext。
func (c *Cipher) Decrypt(blob []byte) ([]byte, error) {
	ns := c.gcm.NonceSize()
	if len(blob) < ns {
		return nil, errors.New("密文过短")
	}
	return c.gcm.Open(nil, blob[:ns], blob[ns:], nil)
}

// EncryptString 便捷方法：加密后 base64。
func (c *Cipher) EncryptString(s string) (string, error) {
	b, err := c.Encrypt([]byte(s))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

// DecryptString 便捷方法：base64 后解密。
func (c *Cipher) DecryptString(s string) (string, error) {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return "", err
	}
	pt, err := c.Decrypt(b)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}
