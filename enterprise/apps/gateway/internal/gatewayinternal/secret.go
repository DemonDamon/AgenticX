package gatewayinternal

import (
	"os"
	"strings"
	"sync"
)

// SecretFromEnv 读一个密钥类环境变量：裸变量优先，其次 <NAME>_FILE 指向的文件。
//
// enterprise/.env.local.example 只教了 *_FILE 这一种写法，过去却只有 start-dev.sh
// 会把它展开成裸变量；绕过 launcher 起网关时，明明配好的 token 会被当成没配。
// TS 侧 admin-console 的 gateway-internal-token.ts 早就是这个行为，这里补齐 Go 侧。
//
// 同时接上 Docker/K8s 的 secret 文件挂载——*_FILE 后缀本来就是那边的通用约定。
func SecretFromEnv(name string) string {
	if direct := strings.TrimSpace(os.Getenv(name)); direct != "" {
		return direct
	}
	path := strings.TrimSpace(os.Getenv(name + "_FILE"))
	if path == "" {
		return ""
	}
	return secretFileCache.read(path)
}

// 鉴权是每个请求都要走的路径，不能每次都去读盘。按路径缓存而不是只读一次：
// 只读一次会让同一进程内换过 env 的测试互相污染。
type fileCache struct {
	mu     sync.RWMutex
	path   string
	value  string
	loaded bool
}

var secretFileCache = &fileCache{}

func (c *fileCache) read(path string) string {
	c.mu.RLock()
	if c.loaded && c.path == path {
		value := c.value
		c.mu.RUnlock()
		return value
	}
	c.mu.RUnlock()

	raw, err := os.ReadFile(path)
	value := ""
	if err == nil {
		value = strings.TrimSpace(string(raw))
	}

	c.mu.Lock()
	c.path, c.value, c.loaded = path, value, true
	c.mu.Unlock()
	return value
}

// ResetSecretCacheForTests 清掉按路径缓存的密钥文件内容。
func ResetSecretCacheForTests() {
	secretFileCache.mu.Lock()
	secretFileCache.path, secretFileCache.value, secretFileCache.loaded = "", "", false
	secretFileCache.mu.Unlock()
}
