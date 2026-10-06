// Package executor 执行动作的 HTTP 调用：模板渲染、凭据注入、SSRF 守护、
// 超时与错误语义（provider_input_error 400 / provider_response_error 502 /
// provider_timeout 504 / ssrf_forbidden 400）。
package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/agenticx/connector-runtime/internal/connection"
	"github.com/agenticx/connector-runtime/internal/model"
)

// 错误码（对齐 400/502/504 语义）。
const (
	CodeInputError    = "provider_input_error"    // 调用方输入问题（400）
	CodeSSRFForbidden = "ssrf_forbidden"          // 出网安全拦截（400）
	CodeUpstreamError = "provider_response_error" // 上游响应异常（502）
	CodeTimeout       = "provider_timeout"        // 上游超时（504）
)

// ExecError 执行错误：码 + 语义化 HTTP 状态 + 不含敏感信息的消息。
type ExecError struct {
	Code       string `json:"code"`
	HTTPStatus int    `json:"-"`
	Message    string `json:"message"`
}

func (e *ExecError) Error() string { return e.Message }

func inputErrorf(format string, a ...any) *ExecError {
	return &ExecError{Code: CodeInputError, HTTPStatus: 400, Message: fmt.Sprintf(format, a...)}
}

func ssrfErrorf(format string, a ...any) *ExecError {
	return &ExecError{Code: CodeSSRFForbidden, HTTPStatus: 400, Message: fmt.Sprintf(format, a...)}
}

func upstreamErrorf(format string, a ...any) *ExecError {
	return &ExecError{Code: CodeUpstreamError, HTTPStatus: 502, Message: fmt.Sprintf(format, a...)}
}

// Options 执行器选项。
type Options struct {
	Timeout              time.Duration // 单次执行超时，默认 30s
	AllowPrivateNetwork  bool          // 允许私网/环回目标（本地调试/内网场景），默认拒绝
	MaxResponseBodyBytes int64         // 响应体上限，默认 10MB
}

const (
	defaultTimeout = 30 * time.Second
	defaultMaxBody = 10 << 20
	maxRedirects   = 10
)

// Result 执行结果（2xx）。Body 为原始响应体，JSON 有效性由展示层判断。
type Result struct {
	StatusCode int
	Body       []byte
	DurationMS int64
}

// Executor 动作执行器。构造后可复用（内部 http.Client 并发安全）。
type Executor struct {
	client *http.Client
	opts   Options
}

// New 构造执行器。
func New(opts Options) *Executor {
	if opts.Timeout <= 0 {
		opts.Timeout = defaultTimeout
	}
	if opts.MaxResponseBodyBytes <= 0 {
		opts.MaxResponseBodyBytes = defaultMaxBody
	}
	tr := &http.Transport{
		// SSRF 守护核心：每次拨号（含重定向后的每一跳）都在连接前校验解析后的 IP。
		DialContext: (&net.Dialer{
			Timeout: 10 * time.Second,
			Control: guardControl(opts.AllowPrivateNetwork),
		}).DialContext,
	}
	client := &http.Client{
		Transport: tr,
		Timeout:   opts.Timeout,
		// 重定向目标校验：scheme 与跳数上限。
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return ssrfErrorf("重定向目标 scheme 不允许: %s", req.URL.Scheme)
			}
			if req.URL.User != nil {
				return ssrfErrorf("重定向目标不允许携带 userinfo")
			}
			if len(via) >= maxRedirects {
				return ssrfErrorf("重定向超过 %d 跳", maxRedirects)
			}
			return nil
		},
	}
	return &Executor{client: client, opts: opts}
}

// guardControl 返回拨号前 IP 校验函数。
func guardControl(allowPrivate bool) func(network, address string, c syscall.RawConn) error {
	return func(network, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return ssrfErrorf("拨号地址不合法: %s", address)
		}
		ip := net.ParseIP(host)
		if ip == nil {
			return ssrfErrorf("拨号地址无法解析为 IP: %s", host)
		}
		if !isForbiddenIP(ip) {
			return nil // 公网地址放行
		}
		if allowPrivate {
			return nil
		}
		return ssrfErrorf("目标地址 %s 属私网/保留地址，已被出网守护拦截", ip)
	}
}

// isForbiddenIP 判断是否私网/环回/链路本地/保留/组播/未指定地址。
func isForbiddenIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified()
}

var templatePattern = regexp.MustCompile(`\{([a-zA-Z0-9_]+)\}`)

// Execute 渲染并执行动作。
func (e *Executor) Execute(ctx context.Context, conn *model.Connector, act model.Action, input map[string]any, sec connection.Secret) (*Result, *ExecError) {
	start := time.Now()

	fullURL, q, hdrs, body, ierr := e.render(conn, act, input)
	if ierr != nil {
		return nil, ierr
	}

	// 凭据注入（凭据只进入请求，不进入任何日志/错误消息）。
	switch conn.Auth.Type {
	case model.AuthAPIKey:
		if sec.APIKey == "" {
			return nil, inputErrorf("连接缺少 api_key 凭据")
		}
		switch conn.Auth.APIKey.In {
		case "header":
			hdrs.Set(conn.Auth.APIKey.Name, sec.APIKey)
		case "query":
			q.Set(conn.Auth.APIKey.Name, sec.APIKey)
		}
	}

	req, err := http.NewRequestWithContext(ctx, act.HTTP.Method, fullURL.String(), bytes.NewReader(body))
	if err != nil {
		return nil, upstreamErrorf("构造请求失败: %v", err)
	}
	req.URL.RawQuery = q.Encode()
	for k, vs := range hdrs {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	if len(body) > 0 && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := e.client.Do(req)
	if err != nil {
		// SSRF 守护与重定向校验的拒绝以原始语义透传（错误链底层是 *ExecError）。
		var guardErr *ExecError
		if errors.As(err, &guardErr) {
			return nil, guardErr
		}
		if isTimeout(err) {
			return nil, &ExecError{Code: CodeTimeout, HTTPStatus: 504, Message: "上游请求超时"}
		}
		// 错误消息只含方法与 host+path，剥离 query（api_key 可能注入其中）。
		return nil, upstreamErrorf("上游请求失败: %s %s: %v", act.HTTP.Method, safeURL(req.URL), unwrapURLError(err))
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, e.opts.MaxResponseBodyBytes+1))
	if err != nil {
		return nil, upstreamErrorf("读取上游响应失败: %v", err)
	}
	if int64(len(respBody)) > e.opts.MaxResponseBodyBytes {
		return nil, upstreamErrorf("上游响应超过 %d 字节上限", e.opts.MaxResponseBodyBytes)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet := truncate(string(respBody), 512)
		return nil, upstreamErrorf("上游返回 %d: %s", resp.StatusCode, snippet)
	}

	return &Result{
		StatusCode: resp.StatusCode,
		Body:       bytes.TrimSpace(respBody),
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}

// render 渲染 URL/查询/header/body。
func (e *Executor) render(conn *model.Connector, act model.Action, input map[string]any) (*url.URL, url.Values, http.Header, []byte, *ExecError) {
	if input == nil {
		input = map[string]any{}
	}
	// 路径模板
	path, ierr := renderTemplate(act.HTTP.Path, input, url.PathEscape)
	if ierr != nil {
		return nil, nil, nil, nil, ierr
	}
	full := strings.TrimRight(conn.BaseURL, "/") + path

	u, err := url.Parse(full)
	if err != nil {
		return nil, nil, nil, nil, inputErrorf("渲染后的 URL 不合法: %v", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, nil, nil, nil, ssrfErrorf("目标 scheme 不允许: %s", u.Scheme)
	}
	if u.User != nil {
		return nil, nil, nil, nil, ssrfErrorf("目标 URL 不允许携带 userinfo")
	}

	// 查询模板：值不做预转义（url.Values.Encode 统一编码，避免双重编码）
	q := url.Values{}
	for k, tmpl := range act.HTTP.Query {
		v, ierr := renderTemplate(tmpl, input, func(s string) string { return s })
		if ierr != nil {
			return nil, nil, nil, nil, ierr
		}
		q.Set(k, v)
	}

	// header 模板
	h := http.Header{}
	for k, tmpl := range act.HTTP.Headers {
		v, ierr := renderTemplate(tmpl, input, func(s string) string { return s })
		if ierr != nil {
			return nil, nil, nil, nil, ierr
		}
		h.Set(k, v)
	}

	// body：写方法以整个输入 JSON 为请求体
	var body []byte
	switch act.HTTP.Method {
	case "POST", "PUT", "PATCH":
		b, err := json.Marshal(input)
		if err != nil {
			return nil, nil, nil, nil, inputErrorf("输入序列化失败: %v", err)
		}
		body = b
	}
	return u, q, h, body, nil
}

// renderTemplate 将 {name} 占位替换为输入中的标量值。
func renderTemplate(tmpl string, input map[string]any, esc func(string) string) (string, *ExecError) {
	var missing []string
	out := templatePattern.ReplaceAllStringFunc(tmpl, func(m string) string {
		name := m[1 : len(m)-1]
		v, ok := input[name]
		if !ok {
			missing = append(missing, name)
			return m
		}
		switch t := v.(type) {
		case string:
			return esc(t)
		case float64, bool, int, int64:
			return esc(fmt.Sprintf("%v", t))
		default:
			missing = append(missing, name+"（非标量）")
			return m
		}
	})
	if len(missing) > 0 {
		return "", inputErrorf("缺少输入参数或参数非标量: %s", strings.Join(missing, ", "))
	}
	return out, nil
}

func isTimeout(err error) bool {
	var ne net.Error
	if errors.As(err, &ne) {
		return ne.Timeout()
	}
	return strings.Contains(err.Error(), "context deadline exceeded") ||
		errors.Is(err, context.DeadlineExceeded)
}

func unwrapURLError(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return ue.Err
	}
	return err
}

// safeURL 只保留 scheme://host/path，剥离 query 与 fragment。
func safeURL(u *url.URL) string {
	clone := *u
	clone.RawQuery = ""
	clone.Fragment = ""
	return clone.String()
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
