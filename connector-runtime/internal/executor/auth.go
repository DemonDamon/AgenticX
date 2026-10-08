package executor

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/connector-runtime/internal/connection"
	"github.com/agenticx/connector-runtime/internal/model"
)

// DefaultHMACStringToSign 默认签名串模板。
const DefaultHMACStringToSign = "{method}\\n{path}\\n{query}\\n{timestamp}\\n{body_sha256}"

// nowFunc 时间源（测试可替换）。
var nowFunc = time.Now

// signHMAC 按规格计算签名并写入 header。凭据只进入请求头，不进入日志/错误。
func signHMAC(spec *model.HMACAuth, req *http.Request, body []byte, sec connection.Secret) *ExecError {
	if sec.AccessKeyID == "" || sec.SecretKey == "" {
		return inputErrorf("连接缺少 AK/SK 凭据")
	}
	now := nowFunc()
	var ts string
	switch spec.TimestampFormat {
	case "unix_ms":
		ts = strconv.FormatInt(now.UnixMilli(), 10)
	case "rfc3339":
		ts = now.UTC().Format(time.RFC3339)
	default:
		ts = strconv.FormatInt(now.Unix(), 10)
	}
	nonce := ""
	if spec.NonceHeader != "" || strings.Contains(spec.StringToSign, "{nonce}") {
		b := make([]byte, 16)
		_, _ = io.ReadFull(rand.Reader, b)
		nonce = hex.EncodeToString(b)
	}
	bodySum := sha256.Sum256(body)
	path := req.URL.EscapedPath()
	if path == "" {
		path = "/"
	}
	tmpl := spec.StringToSign
	if tmpl == "" {
		tmpl = DefaultHMACStringToSign
	}
	stringToSign := strings.NewReplacer(
		"{method}", req.Method,
		"{path}", path,
		"{query}", req.URL.Query().Encode(), // 按 key 排序
		"{timestamp}", ts,
		"{nonce}", nonce,
		"{body_sha256}", hex.EncodeToString(bodySum[:]),
		"{access_key}", sec.AccessKeyID,
		"{host}", req.URL.Host,
		"\\n", "\n",
	).Replace(tmpl)
	mac := hmac.New(sha256.New, []byte(sec.SecretKey))
	mac.Write([]byte(stringToSign))
	sum := mac.Sum(nil)
	sig := hex.EncodeToString(sum)
	if spec.SignatureEncoding == "base64" {
		sig = base64.StdEncoding.EncodeToString(sum)
	}
	req.Header.Set(spec.AccessKeyHeader, sec.AccessKeyID)
	req.Header.Set(spec.SignatureHeader, spec.SignaturePrefix+sig)
	if spec.TimestampHeader != "" {
		req.Header.Set(spec.TimestampHeader, ts)
	}
	if spec.NonceHeader != "" {
		req.Header.Set(spec.NonceHeader, nonce)
	}
	return nil
}

// ---- OAuth 2.0 ----

type cachedToken struct {
	access string
	expiry time.Time
}

// tokenCache access token 缓存（进程内，不落盘）。
type tokenCache struct {
	mu     sync.Mutex
	tokens map[string]cachedToken
}

func (c *tokenCache) get(key string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	t, ok := c.tokens[key]
	if !ok || (!t.expiry.IsZero() && nowFunc().After(t.expiry.Add(-30*time.Second))) {
		return "", false
	}
	return t.access, true
}

func (c *tokenCache) put(key, access string, expiresIn int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	var exp time.Time
	if expiresIn > 0 {
		exp = nowFunc().Add(time.Duration(expiresIn) * time.Second)
	}
	c.tokens[key] = cachedToken{access: access, expiry: exp}
}

func (c *tokenCache) drop(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.tokens, key)
}

func oauthCacheKey(conn *model.Connector, connID string, sec connection.Secret) string {
	if connID != "" {
		return conn.ID + "|" + connID
	}
	sum := sha256.Sum256([]byte(conn.ID + "|" + sec.ClientID + "|" + sec.ClientSecret + "|" + sec.RefreshToken))
	return hex.EncodeToString(sum[:])
}

type tokenResponse struct {
	AccessToken  string          `json:"access_token"`
	TokenType    string          `json:"token_type"`
	ExpiresIn    json.RawMessage `json:"expires_in"`
	RefreshToken string          `json:"refresh_token"`
	Error        string          `json:"error"`
	ErrorDesc    string          `json:"error_description"`
}

func (r tokenResponse) expiresIn() int64 {
	s := strings.Trim(string(r.ExpiresIn), `"`)
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

// oauthToken 返回可用 access token（缓存命中直接返回；否则按 grant 换取/刷新）。
func (e *Executor) oauthToken(ctx context.Context, conn *model.Connector, connID string, sec connection.Secret, force bool) (string, *ExecError) {
	spec := conn.Auth.OAuth2
	key := oauthCacheKey(conn, connID, sec)
	if !force {
		if tok, ok := e.tokens.get(key); ok {
			return tok, nil
		}
	}
	if sec.ClientID == "" {
		return "", inputErrorf("连接缺少 OAuth client_id")
	}
	form := url.Values{}
	switch spec.Grant {
	case "client_credentials":
		form.Set("grant_type", "client_credentials")
		if len(spec.Scopes) > 0 {
			form.Set("scope", strings.Join(spec.Scopes, " "))
		}
	case "authorization_code":
		if sec.RefreshToken == "" {
			return "", inputErrorf("连接尚未完成 OAuth 授权（缺少 refresh_token），请先在桌面端完成浏览器授权")
		}
		form.Set("grant_type", "refresh_token")
		form.Set("refresh_token", sec.RefreshToken)
	default:
		return "", inputErrorf("不支持的 oauth2.grant: %s", spec.Grant)
	}
	basic := spec.ClientAuth == "basic"
	if !basic {
		form.Set("client_id", sec.ClientID)
		if sec.ClientSecret != "" {
			form.Set("client_secret", sec.ClientSecret)
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, spec.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", upstreamErrorf("构造 token 请求失败")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if basic {
		req.SetBasicAuth(url.QueryEscape(sec.ClientID), url.QueryEscape(sec.ClientSecret))
	}
	resp, err := e.client.Do(req)
	if err != nil {
		if ge := asExecError(err); ge != nil {
			return "", ge
		}
		return "", upstreamErrorf("获取 OAuth token 失败: %s: %v", safeURL(req.URL), unwrapURLError(err))
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var tr tokenResponse
	_ = json.Unmarshal(raw, &tr)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || tr.AccessToken == "" {
		code := tr.Error
		if code == "" {
			code = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		// 只回传 error 码与描述，不回传响应体（可能含敏感字段）。
		return "", upstreamErrorf("OAuth token 端点拒绝: %s %s", code, truncate(tr.ErrorDesc, 200))
	}
	e.tokens.put(key, tr.AccessToken, tr.expiresIn())
	if tr.RefreshToken != "" && tr.RefreshToken != sec.RefreshToken && connID != "" && e.opts.SecretUpdater != nil {
		rotated := sec
		rotated.RefreshToken = tr.RefreshToken
		_ = e.opts.SecretUpdater(ctx, connID, rotated)
	}
	return tr.AccessToken, nil
}
