package model

import (
	"encoding/json"
	"strings"
	"testing"
)

// validDef 一份各字段齐全的合法定义，非法用例在其上做单点变异。
const validDef = `{
  "id": "httpbin",
  "displayName": "HTTPBin",
  "description": "HTTP 调试服务",
  "homepageUrl": "https://httpbin.org",
  "categories": ["devtools", "testing"],
  "baseUrl": "https://httpbin.org",
  "auth": {"type": "none"},
  "actions": [
    {
      "id": "httpbin.get",
      "title": "GET 回显",
      "description": "返回请求回显",
      "operationType": "read",
      "inputSchema": {"type": "object", "properties": {"x": {"type": "string"}}},
      "http": {"method": "GET", "path": "/get", "query": {"x": "{x}"}}
    },
    {
      "id": "httpbin.echo_post",
      "title": "POST 回显",
      "operationType": "write",
      "requiredScopes": ["echo"],
      "http": {"method": "POST", "path": "/post"}
    }
  ]
}`

func mustParse(t *testing.T, raw string) *Connector {
	t.Helper()
	c, err := Parse([]byte(raw))
	if err != nil {
		t.Fatalf("解析合法定义失败: %v", err)
	}
	return c
}

func TestParseValid(t *testing.T) {
	c := mustParse(t, validDef)
	if c.ID != "httpbin" || len(c.Actions) != 2 {
		t.Fatalf("字段解析不符: %+v", c)
	}
	if c.Actions[0].HTTP.Query["x"] != "{x}" {
		t.Fatalf("query 模板未解析: %+v", c.Actions[0].HTTP)
	}
	if c.Actions[1].RequiredScopes[0] != "echo" {
		t.Fatalf("requiredScopes 未解析: %+v", c.Actions[1])
	}
}

func TestValidateInvalid(t *testing.T) {
	mutate := func(f func(map[string]any)) string {
		var m map[string]any
		if err := json.Unmarshal([]byte(validDef), &m); err != nil {
			t.Fatal(err)
		}
		f(m)
		out, _ := json.Marshal(m)
		return string(out)
	}
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"id 非法字符", mutate(func(m map[string]any) { m["id"] = "Http Bin" }), "id"},
		{"id 为空", mutate(func(m map[string]any) { m["id"] = "" }), "id"},
		{"displayName 空", mutate(func(m map[string]any) { m["displayName"] = "  " }), "displayName"},
		{"baseUrl 非 http", mutate(func(m map[string]any) { m["baseUrl"] = "ftp://x.example" }), "scheme"},
		{"baseUrl 带 userinfo", mutate(func(m map[string]any) { m["baseUrl"] = "https://u:p@x.example" }), "userinfo"},
		{"baseUrl 带 query", mutate(func(m map[string]any) { m["baseUrl"] = "https://x.example?a=1" }), "query"},
		{"auth 类型未知", mutate(func(m map[string]any) { m["auth"] = map[string]any{"type": "oauth9"} }), "认证类型"},
		{"api_key 缺规格", mutate(func(m map[string]any) { m["auth"] = map[string]any{"type": "api_key"} }), "apiKey"},
		{"api_key in 非法", mutate(func(m map[string]any) {
			m["auth"] = map[string]any{"type": "api_key", "apiKey": map[string]any{"in": "cookie", "name": "k"}}
		}), "in"},
		{"无 action", mutate(func(m map[string]any) { m["actions"] = []any{} }), "action"},
		{"action 前缀错", mutate(func(m map[string]any) {
			m["actions"].([]any)[0].(map[string]any)["id"] = "other.get"
		}), "前缀"},
		{"action id 重复", mutate(func(m map[string]any) {
			m["actions"].([]any)[1].(map[string]any)["id"] = "httpbin.get"
		}), "重复"},
		{"operationType 非法", mutate(func(m map[string]any) {
			m["actions"].([]any)[0].(map[string]any)["operationType"] = "delete"
		}), "operationType"},
		{"method 小写", mutate(func(m map[string]any) {
			m["actions"].([]any)[0].(map[string]any)["http"] = map[string]any{"method": "get", "path": "/get"}
		}), "method"},
		{"path 不以 / 开头", mutate(func(m map[string]any) {
			m["actions"].([]any)[0].(map[string]any)["http"] = map[string]any{"method": "GET", "path": "get"}
		}), "path"},
		{"JSON 损坏", `{ "id": `, "解析"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.raw))
			if err == nil {
				t.Fatalf("期望校验失败，却通过了")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("错误信息 %q 未包含关键词 %q", err.Error(), tc.want)
			}
		})
	}
}

func TestValidateIDEdge(t *testing.T) {
	for _, id := range []string{"a", "ip-info", "x1"} {
		c := mustParse(t, validDef)
		c.ID = id
		c.Actions[0].ID = id + ".get"
		c.Actions[1].ID = id + ".echo_post"
		if err := c.Validate(); err != nil {
			t.Fatalf("合法 id %q 被拒: %v", id, err)
		}
	}
	for _, id := range []string{"-a", "a-", "Aa", "a_b", strings.Repeat("a", 66)} {
		c := mustParse(t, validDef)
		c.ID = id
		if err := c.Validate(); err == nil {
			t.Fatalf("非法 id %q 通过", id)
		}
	}
}
