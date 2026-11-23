// Package gatewayinternal 提供网关调用 admin-console internal 路由时的极简 HTTP GET（Bearer 鉴权）。
package gatewayinternal

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
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

// HTTPGetWithHeaders 在保留内部 Bearer 鉴权的同时附加调用方请求头（例如租户）。
func HTTPGetWithHeaders(url string, headers map[string]string) ([]byte, int, error) {
	if !IsHTTPURL(url) {
		return nil, 0, fmt.Errorf("gatewayinternal: URL must start with http:// or https://")
	}
	token := SecretFromEnv("GATEWAY_INTERNAL_TOKEN")
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

// HTTPPost 使用与 HTTPGet 相同的客户端：默认 Transport（环境变量代理）、25 秒超时、内部 Bearer。
// 不替换 Transport，避免空 Transport 绕过代理。状态码原样返回，由调用方判断是否成功。
func HTTPPost(url string, body []byte) (int, error) {
	if !IsHTTPURL(url) {
		return 0, fmt.Errorf("gatewayinternal: URL must start with http:// or https://")
	}
	token := SecretFromEnv("GATEWAY_INTERNAL_TOKEN")
	client := &http.Client{Timeout: 25 * time.Second}
	req, err := http.NewRequest(http.MethodPost, strings.TrimSpace(url), bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, err = io.Copy(io.Discard, io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return resp.StatusCode, err
	}
	return resp.StatusCode, nil
}
