package connectorstore

import (
	"encoding/base64"
	"os"
)

// envMasterKey 读取主密钥环境变量（函数变量便于测试替换）。
var envMasterKey = func() string {
	return os.Getenv(MasterKeyEnv)
}

// decodeBase64Key 解码 base64(std) 主密钥。
func decodeBase64Key(s string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(s)
}
