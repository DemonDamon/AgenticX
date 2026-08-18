// Package gatewayinternal 提供网关调用 admin-console internal 路由时的极简 HTTP GET（Bearer 鉴权）。
package gatewayinternal

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const maxBodyBytes = 32 << 20

// IsHTTPURL 判断是否为 http(s) 远程配置地址。
func IsHTTPURL(s string) bool {
	t := strings.TrimSpace(s)
	return strings.HasPrefix(t, "http://") || strings.HasPrefix(t, "https://")
}

// HTTPGet 使用 GATEWAY_INTERNAL_TOKEN（若配置）发起 GET；返回响应体切片、HTTP 状态码与错误。
func HTTPGet(url string) ([]byte, int, error) {
	return HTTPGetWithHeaders(url, nil)
}

// HTTPGetWithHeaders adds caller-scoped routing headers while retaining the
// shared internal bearer authentication and response-size guard.
func HTTPGetWithHeaders(url string, headers map[string]string) ([]byte, int, error) {
	if !IsHTTPURL(url) {
		return nil, 0, fmt.Errorf("gatewayinternal: URL must start with http:// or https://")
	}
	token := strings.TrimSpace(os.Getenv("GATEWAY_INTERNAL_TOKEN"))
	client := &http.Client{Timeout: 25 * time.Second}
	req, err := http.NewRequest(http.MethodGet, strings.TrimSpace(url), nil)
	if err != nil {
		return nil, 0, err
	}
	for key, value := range headers {
		if strings.TrimSpace(key) != "" && strings.TrimSpace(value) != "" {
			req.Header.Set(key, strings.TrimSpace(value))
		}
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}
