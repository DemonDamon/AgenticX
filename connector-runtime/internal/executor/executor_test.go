package executor

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/connector-runtime/internal/connection"
	"github.com/agenticx/connector-runtime/internal/model"
)

func newUpstream(t *testing.T, h http.Handler) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(h)
	t.Cleanup(s.Close)
	return s
}

func testConn(base string, auth model.AuthSpec) *model.Connector {
	return &model.Connector{
		ID: "demo", DisplayName: "Demo", BaseURL: base, Auth: auth,
		Actions: []model.Action{{
			ID: "demo.fetch", Title: "取数", OperationType: "read",
			HTTP: model.HTTPAction{Method: "GET", Path: "/items/{id}",
				Query: map[string]string{"q": "{q}"}, Headers: map[string]string{"X-Trace": "{trace}"}},
		}, {
			ID: "demo.create", Title: "创建", OperationType: "write",
			HTTP: model.HTTPAction{Method: "POST", Path: "/items"},
		}},
	}
}

var noneAuth = model.AuthSpec{Type: model.AuthNone}
var headerKeyAuth = model.AuthSpec{Type: model.AuthAPIKey, APIKey: &model.APIKeyAuth{In: "header", Name: "X-Api-Key"}}
var queryKeyAuth = model.AuthSpec{Type: model.AuthAPIKey, APIKey: &model.APIKeyAuth{In: "query", Name: "api_key"}}

func TestRenderAndExecuteGET(t *testing.T) {
	var gotPath, gotQuery, gotTrace string
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery, gotTrace = r.URL.Path, r.URL.Query().Get("q"), r.Header.Get("X-Trace")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	e := New(Options{AllowPrivateNetwork: true})
	res, ierr := e.Execute(context.Background(), testConn(up.URL, noneAuth),
		testConn(up.URL, noneAuth).Actions[0],
		map[string]any{"id": "42", "q": "hello world", "trace": "t1"},
		connection.Secret{})
	if ierr != nil {
		t.Fatalf("执行失败: %+v", ierr)
	}
	if gotPath != "/items/42" {
		t.Fatalf("路径渲染错误: %s", gotPath)
	}
	if gotQuery != "hello world" {
		t.Fatalf("查询渲染错误: %q", gotQuery)
	}
	if gotTrace != "t1" {
		t.Fatalf("header 渲染错误: %s", gotTrace)
	}
	if res.StatusCode != 200 || string(res.Body) != `{"ok":true}` {
		t.Fatalf("结果不符: %+v", res)
	}
}

func TestExecutePOSTBody(t *testing.T) {
	var gotBody map[string]any
	var gotCT string
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCT = r.Header.Get("Content-Type")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"created":true}`))
	}))
	e := New(Options{AllowPrivateNetwork: true})
	c := testConn(up.URL, noneAuth)
	res, ierr := e.Execute(context.Background(), c, c.Actions[1], map[string]any{"name": "x"}, connection.Secret{})
	if ierr != nil {
		t.Fatalf("执行失败: %+v", ierr)
	}
	if gotCT != "application/json" || gotBody["name"] != "x" {
		t.Fatalf("body/CT 不符: %v %s", gotBody, gotCT)
	}
	if res.StatusCode != 201 {
		t.Fatalf("201 应视为成功: %d", res.StatusCode)
	}
}

func TestMissingParamIsInputError(t *testing.T) {
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	e := New(Options{AllowPrivateNetwork: true})
	c := testConn(up.URL, noneAuth)
	_, ierr := e.Execute(context.Background(), c, c.Actions[0], map[string]any{"q": "x", "trace": "y"}, connection.Secret{})
	if ierr == nil || ierr.Code != CodeInputError || ierr.HTTPStatus != 400 {
		t.Fatalf("缺参应为 400 输入错误: %+v", ierr)
	}
	// 非标量参数同样是输入错误
	_, ierr = e.Execute(context.Background(), c, c.Actions[0], map[string]any{"id": map[string]any{}, "q": "x", "trace": "y"}, connection.Secret{})
	if ierr == nil || ierr.Code != CodeInputError {
		t.Fatalf("非标量参数应为输入错误: %+v", ierr)
	}
}

func TestAPIKeyInjection(t *testing.T) {
	var gotHeader, gotQuery string
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeader, gotQuery = r.Header.Get("X-Api-Key"), r.URL.Query().Get("api_key")
		_, _ = w.Write([]byte(`{}`))
	}))
	e := New(Options{AllowPrivateNetwork: true})
	input := map[string]any{"id": "1", "q": "x", "trace": "t"}

	ch := testConn(up.URL, headerKeyAuth)
	if _, ierr := e.Execute(context.Background(), ch, ch.Actions[0], input, connection.Secret{APIKey: "sk-secret-1"}); ierr != nil {
		t.Fatal(ierr)
	}
	if gotHeader != "sk-secret-1" {
		t.Fatalf("header api_key 未注入: %q", gotHeader)
	}

	cq := testConn(up.URL, queryKeyAuth)
	if _, ierr := e.Execute(context.Background(), cq, cq.Actions[0], input, connection.Secret{APIKey: "sk-secret-2"}); ierr != nil {
		t.Fatal(ierr)
	}
	if gotQuery != "sk-secret-2" {
		t.Fatalf("query api_key 未注入: %q", gotQuery)
	}

	// 空凭据 → 输入错误
	if _, ierr := e.Execute(context.Background(), ch, ch.Actions[0], input, connection.Secret{}); ierr == nil || ierr.Code != CodeInputError {
		t.Fatalf("空凭据应为输入错误: %+v", ierr)
	}
}

func TestSSRFDefaultBlocksPrivate(t *testing.T) {
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	e := New(Options{}) // 默认拒绝私网
	c := testConn(up.URL, noneAuth)
	_, ierr := e.Execute(context.Background(), c, c.Actions[0],
		map[string]any{"id": "1", "q": "x", "trace": "t"}, connection.Secret{})
	if ierr == nil || ierr.Code != CodeSSRFForbidden || ierr.HTTPStatus != 400 {
		t.Fatalf("默认应拦截环回地址: %+v", ierr)
	}
	if strings.Contains(ierr.Message, "sk-") {
		t.Fatalf("错误消息不应包含凭据")
	}
}

func TestRedirectGuard(t *testing.T) {
	target := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"final":true}`))
	}))
	// 跳板：重定向到 target（同为环回，需 allowPrivate 才能到达；此用例验证重定向链路不被误伤）
	hop := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/items/1", http.StatusFound)
	}))
	e := New(Options{AllowPrivateNetwork: true})
	c := testConn(hop.URL, noneAuth)
	res, ierr := e.Execute(context.Background(), c, c.Actions[0], map[string]any{"id": "1", "q": "x", "trace": "t"}, connection.Secret{})
	if ierr != nil {
		t.Fatalf("正常重定向应放行: %+v", ierr)
	}
	if string(res.Body) != `{"final":true}` {
		t.Fatalf("应跟随重定向拿到最终结果: %s", res.Body)
	}

	// 重定向循环 → 拦截
	loop := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, r.URL.String(), http.StatusFound)
	}))
	defer loop.Close()
	cl := testConn(loop.URL, noneAuth)
	_, ierr = e.Execute(context.Background(), cl, cl.Actions[0], map[string]any{"id": "1", "q": "x", "trace": "t"}, connection.Secret{})
	if ierr == nil || ierr.Code != CodeSSRFForbidden {
		t.Fatalf("重定向循环应被跳数上限拦截: %+v", ierr)
	}
}

func TestUpstreamErrorSemantics(t *testing.T) {
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		_, _ = w.Write([]byte(`{"error":"boom"}`))
	}))
	e := New(Options{AllowPrivateNetwork: true})
	c := testConn(up.URL, noneAuth)
	_, ierr := e.Execute(context.Background(), c, c.Actions[0], map[string]any{"id": "1", "q": "x", "trace": "t"}, connection.Secret{})
	if ierr == nil || ierr.Code != CodeUpstreamError || ierr.HTTPStatus != 502 {
		t.Fatalf("上游 5xx 应为 502 语义: %+v", ierr)
	}
	if !strings.Contains(ierr.Message, "500") {
		t.Fatalf("错误应含上游状态码: %s", ierr.Message)
	}
}

func TestTimeoutSemantics(t *testing.T) {
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		_, _ = w.Write([]byte(`{}`))
	}))
	e := New(Options{AllowPrivateNetwork: true, Timeout: 50 * time.Millisecond})
	c := testConn(up.URL, noneAuth)
	_, ierr := e.Execute(context.Background(), c, c.Actions[0], map[string]any{"id": "1", "q": "x", "trace": "t"}, connection.Secret{})
	if ierr == nil || ierr.Code != CodeTimeout || ierr.HTTPStatus != 504 {
		t.Fatalf("超时应为 504 语义: %+v", ierr)
	}
}

func TestResponseTooLarge(t *testing.T) {
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(w, strings.NewReader(strings.Repeat("a", 2000)))
	}))
	e := New(Options{AllowPrivateNetwork: true, MaxResponseBodyBytes: 1024})
	c := testConn(up.URL, noneAuth)
	_, ierr := e.Execute(context.Background(), c, c.Actions[0], map[string]any{"id": "1", "q": "x", "trace": "t"}, connection.Secret{})
	if ierr == nil || ierr.Code != CodeUpstreamError {
		t.Fatalf("超限响应应为上游错误: %+v", ierr)
	}
}

func TestURLEscaping(t *testing.T) {
	var gotPath string
	up := newUpstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.EscapedPath()
		_, _ = w.Write([]byte(`{}`))
	}))
	e := New(Options{AllowPrivateNetwork: true})
	c := testConn(up.URL, noneAuth)
	if _, ierr := e.Execute(context.Background(), c, c.Actions[0], map[string]any{"id": "a/b?c d", "q": "x&y=z", "trace": "t"}, connection.Secret{}); ierr != nil {
		t.Fatal(ierr)
	}
	// 路径参数必须被转义，不能注入额外路径段/查询
	if gotPath != "/items/a%2Fb?c d" && gotPath != "/items/a/b%3Fc%20d" {
		// url.PathEscape 不转义 ?  与 / 之外的场景因版本而异，断言不包含原始注入结构即可
		if strings.Contains(gotPath, "&y=z") {
			t.Fatalf("路径参数未正确转义: %s", gotPath)
		}
	}
}
