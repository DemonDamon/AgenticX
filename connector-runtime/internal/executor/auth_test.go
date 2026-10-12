package executor

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenticx/connector-runtime/internal/connection"
	"github.com/agenticx/connector-runtime/internal/model"
)

func oneAction(base string, auth model.AuthSpec) (*model.Connector, model.Action) {
	c := &model.Connector{ID: "svc", DisplayName: "Svc", BaseURL: base, Auth: auth, AllowPrivateNetwork: true,
		Actions: []model.Action{{ID: "svc.list", Title: "列表", OperationType: "read",
			HTTP: model.HTTPAction{Method: "GET", Path: "/v1/items", Query: map[string]string{"limit": "{limit}", "b": "{b}"}}}}}
	return c, c.Actions[0]
}

func TestBearerAuth(t *testing.T) {
	var got string
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{}`))
	}))
	c, a := oneAction(up.URL, model.AuthSpec{Type: model.AuthBearer})
	if _, err := New(Options{}).Execute(context.Background(), c, a, nil, connection.Secret{APIKey: "tok-1"}); err != nil {
		t.Fatal(err)
	}
	if got != "Bearer tok-1" {
		t.Fatalf("bearer 注入错误: %q", got)
	}
}

func TestOptionalQueryOmitted(t *testing.T) {
	var raw string
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw = r.URL.RawQuery
		_, _ = w.Write([]byte(`{}`))
	}))
	c, a := oneAction(up.URL, model.AuthSpec{Type: model.AuthNone})
	if _, err := New(Options{}).Execute(context.Background(), c, a, map[string]any{"limit": float64(5)}, connection.Secret{}); err != nil {
		t.Fatal(err)
	}
	if raw != "limit=5" {
		t.Fatalf("可选 query 未省略: %q", raw)
	}
}

func TestHMACSignature(t *testing.T) {
	nowFunc = func() time.Time { return time.Unix(1700000000, 0) }
	defer func() { nowFunc = time.Now }()
	var hdr http.Header
	var path, query string
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hdr, path, query = r.Header.Clone(), r.URL.EscapedPath(), r.URL.Query().Encode()
		_, _ = w.Write([]byte(`{}`))
	}))
	spec := &model.HMACAuth{AccessKeyHeader: "X-Access-Key", SignatureHeader: "X-Signature", TimestampHeader: "X-Timestamp"}
	c, a := oneAction(up.URL, model.AuthSpec{Type: model.AuthHMAC, HMAC: spec})
	sec := connection.Secret{AccessKeyID: "AK1", SecretKey: "SK-secret"}
	if _, err := New(Options{}).Execute(context.Background(), c, a, map[string]any{"limit": "2", "b": "x y"}, sec); err != nil {
		t.Fatal(err)
	}
	empty := sha256.Sum256(nil)
	sts := strings.Join([]string{"GET", path, query, "1700000000", hex.EncodeToString(empty[:])}, "\n")
	m := hmac.New(sha256.New, []byte("SK-secret"))
	m.Write([]byte(sts))
	want := hex.EncodeToString(m.Sum(nil))
	if hdr.Get("X-Access-Key") != "AK1" || hdr.Get("X-Timestamp") != "1700000000" || hdr.Get("X-Signature") != want {
		t.Fatalf("签名不符: ak=%s ts=%s sig=%s want=%s", hdr.Get("X-Access-Key"), hdr.Get("X-Timestamp"), hdr.Get("X-Signature"), want)
	}
	// 缺 SK → 输入错误，且错误消息不含 AK/SK
	_, xerr := New(Options{}).Execute(context.Background(), c, a, nil, connection.Secret{AccessKeyID: "AK1"})
	if xerr == nil || xerr.Code != CodeInputError || strings.Contains(xerr.Message, "AK1") {
		t.Fatalf("缺 SK 应报输入错误: %+v", xerr)
	}
}

func TestOAuthClientCredentialsCacheAndRetry(t *testing.T) {
	var tokenCalls, apiCalls int32
	var gotForm url.Values
	tokenSrv := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&tokenCalls, 1)
		_ = r.ParseForm()
		gotForm = r.PostForm
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"access_token":"at-`+string(rune('0'+n))+`","expires_in":3600,"token_type":"Bearer"}`)
	}))
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&apiCalls, 1)
		// 第 2 次调用模拟 token 被吊销：at-1 → 401，迫使重取 at-2
		if n == 2 && r.Header.Get("Authorization") == "Bearer at-1" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `{"auth":"`+r.Header.Get("Authorization")+`"}`)
	}))
	c, a := oneAction(up.URL, model.AuthSpec{Type: model.AuthOAuth2, OAuth2: &model.OAuth2Auth{
		Grant: "client_credentials", TokenURL: tokenSrv.URL + "/token", Scopes: []string{"read", "write"}}})
	e := New(Options{})
	sec := connection.Secret{ClientID: "cid", ClientSecret: "csecret"}
	r1, err := e.ExecuteConn(context.Background(), c, a, nil, sec, "conn-1")
	if err != nil || !strings.Contains(string(r1.Body), "at-1") {
		t.Fatalf("首次执行失败: %+v %v", err, r1)
	}
	if gotForm.Get("grant_type") != "client_credentials" || gotForm.Get("scope") != "read write" || gotForm.Get("client_id") != "cid" {
		t.Fatalf("token 请求参数不符: %v", gotForm)
	}
	r2, err := e.ExecuteConn(context.Background(), c, a, nil, sec, "conn-1")
	if err != nil || !strings.Contains(string(r2.Body), "at-2") {
		t.Fatalf("401 后应重取 token: %+v", err)
	}
	if _, err := e.ExecuteConn(context.Background(), c, a, nil, sec, "conn-1"); err != nil {
		t.Fatal(err)
	}
	if tokenCalls != 2 {
		t.Fatalf("token 应被缓存（期望 2 次，实际 %d）", tokenCalls)
	}
}

func TestOAuthRefreshTokenRotationPersisted(t *testing.T) {
	tokenSrv := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.PostForm.Get("grant_type") != "refresh_token" || r.PostForm.Get("refresh_token") != "rt-old" {
			w.WriteHeader(400)
			_, _ = io.WriteString(w, `{"error":"invalid_grant"}`)
			return
		}
		_, _ = io.WriteString(w, `{"access_token":"at-x","expires_in":"60","refresh_token":"rt-new"}`)
	}))
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{}`)) }))
	c, a := oneAction(up.URL, model.AuthSpec{Type: model.AuthOAuth2, OAuth2: &model.OAuth2Auth{
		Grant: "authorization_code", TokenURL: tokenSrv.URL + "/token", AuthorizeURL: tokenSrv.URL + "/authorize"}})
	var saved connection.Secret
	e := New(Options{SecretUpdater: func(_ context.Context, id string, sec connection.Secret) error {
		saved = sec
		return nil
	}})
	if _, err := e.ExecuteConn(context.Background(), c, a, nil, connection.Secret{ClientID: "cid", RefreshToken: "rt-old"}, "conn-9"); err != nil {
		t.Fatal(err)
	}
	if saved.RefreshToken != "rt-new" || saved.ClientID != "cid" {
		t.Fatalf("refresh_token 轮换未回写: %+v", saved)
	}
	// 未授权（无 refresh_token）给出可读提示
	_, xerr := e.ExecuteConn(context.Background(), c, a, nil, connection.Secret{ClientID: "cid"}, "conn-10")
	if xerr == nil || !strings.Contains(xerr.Message, "授权") {
		t.Fatalf("应提示先授权: %+v", xerr)
	}
}

func TestPrivateNetworkIsPerConnector(t *testing.T) {
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{}`)) }))
	c, a := oneAction(up.URL, model.AuthSpec{Type: model.AuthNone})
	c.AllowPrivateNetwork = false
	_, xerr := New(Options{}).Execute(context.Background(), c, a, nil, connection.Secret{})
	if xerr == nil || xerr.Code != CodeSSRFForbidden {
		t.Fatalf("未放行的连接器访问环回应被拦截: %+v", xerr)
	}
	c.AllowPrivateNetwork = true
	if _, xerr := New(Options{}).Execute(context.Background(), c, a, nil, connection.Secret{}); xerr != nil {
		t.Fatalf("放行的连接器应可访问环回: %+v", xerr)
	}
}

// deadPort 返回一个当前无人监听的本地端口。
func deadPort(t *testing.T) string {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()
	return addr
}

func TestProxyPolicyLocalBypassAndDeadProxyFallback(t *testing.T) {
	proxyProbeMu.Lock()
	proxyProbeCache = map[string]proxyProbe{}
	proxyProbeMu.Unlock()
	dead := "http://" + deadPort(t)
	t.Setenv("HTTP_PROXY", dead)
	t.Setenv("HTTPS_PROXY", dead)
	t.Setenv("NO_PROXY", "")
	// 1) 本地目标：即使代理配置存在也直连
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"ok":1}`)) }))
	c, a := oneAction(up.URL, model.AuthSpec{Type: model.AuthNone})
	if _, xerr := New(Options{}).Execute(context.Background(), c, a, nil, connection.Secret{}); xerr != nil {
		t.Fatalf("代理死端口时本地目标应直连成功: %+v", xerr)
	}
	// 2) 远端目标 + 死代理：Proxy 返回 nil（直连回落）
	req, _ := http.NewRequest("GET", "https://example.com/x", nil)
	pu, err := policyProxy(req)
	if err != nil || pu != nil {
		t.Fatalf("死代理应回落直连: %v %v", pu, err)
	}
	// 3) 远端目标 + 活代理：使用代理
	live := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer live.Close()
	t.Setenv("HTTPS_PROXY", live.URL)
	req2, _ := http.NewRequestWithContext(context.WithValue(context.Background(), ctxAllowPrivate{}, true), "GET", "https://example.com/x", nil)
	pu, err = policyProxy(req2)
	if err != nil || pu == nil || pu.Host != strings.TrimPrefix(live.URL, "http://") {
		t.Fatalf("活代理应被使用: %v %v", pu, err)
	}
	// 4) NO_PROXY 命中直连
	t.Setenv("NO_PROXY", "example.com")
	if pu, _ := policyProxy(req2); pu != nil {
		t.Fatalf("NO_PROXY 应直连: %v", pu)
	}
	// 5) 本机代理端点本身不被出网守护拦截
	t.Setenv("NO_PROXY", "")
	host := strings.TrimPrefix(live.URL, "http://")
	if !isConfiguredProxyAddr(host) {
		t.Fatalf("应识别本机代理端点 %s", host)
	}
}

func TestIsLocalHost(t *testing.T) {
	for _, h := range []string{"localhost", "127.0.0.1", "127.8.9.1", "::1", "[::1]", "10.0.0.2", "192.168.3.4", "172.16.0.1", "printer.local", "a.localhost"} {
		if !isLocalHost(h) {
			t.Fatalf("%s 应为本地", h)
		}
	}
	for _, h := range []string{"example.com", "8.8.8.8", "localhost.example.com"} {
		if isLocalHost(h) {
			t.Fatalf("%s 不应为本地", h)
		}
	}
}
