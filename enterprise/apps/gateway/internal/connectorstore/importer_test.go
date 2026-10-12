package connectorstore

import (
	"encoding/json"
	"strings"
	"testing"
)

// 导入用 OpenAPI 文档（覆盖 read/write/destructive、query/header 参数、请求体 $ref、apiKey 方案）。
const importDoc = `{
  "openapi": "3.0.3",
  "info": {"title": "内部工单系统", "description": "工单查询与创建"},
  "servers": [{"url": "https://tickets.internal.example.com/v1"}],
  "components": {
    "securitySchemes": {
      "ticketKey": {"type": "apiKey", "in": "header", "name": "X-Ticket-Key"}
    },
    "schemas": {
      "CreateTicket": {
        "type": "object",
        "properties": {
          "title": {"type": "string"},
          "priority": {"type": "string", "enum": ["low", "high"]}
        },
        "required": ["title"]
      }
    }
  },
  "paths": {
    "/tickets/{ticketId}": {
      "get": {
        "operationId": "GetTicket",
        "summary": "查询单个工单",
        "parameters": [
          {"name": "ticketId", "in": "path", "required": true, "schema": {"type": "string"}}
        ]
      },
      "delete": {
        "operationId": "deleteTicket",
        "summary": "删除工单"
      }
    },
    "/tickets": {
      "get": {
        "summary": "搜索工单",
        "parameters": [
          {"name": "status", "in": "query", "schema": {"type": "string"}},
          {"name": "X-Request-Source", "in": "header", "schema": {"type": "string"}}
        ]
      },
      "post": {
        "operationId": "create_ticket",
        "summary": "创建工单",
        "requestBody": {
          "required": true,
          "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CreateTicket"}}}
        }
      }
    }
  }
}`

func TestImportOpenAPIBasicMapping(t *testing.T) {
	res, err := ImportOpenAPI([]byte(importDoc), ImportOptions{ConnectorID: "tickets", ConfirmDestructive: true})
	if err != nil {
		t.Fatal(err)
	}
	c := res.Connector
	if c.ID != "tickets" || c.DisplayName != "内部工单系统" {
		t.Fatalf("基础字段不符: %s / %s", c.ID, c.DisplayName)
	}
	if c.BaseURL != "https://tickets.internal.example.com/v1" {
		t.Fatalf("baseUrl 应取 servers[0]: %s", c.BaseURL)
	}
	if c.Auth.Type != "api_key" || c.Auth.APIKey == nil || c.Auth.APIKey.Name != "X-Ticket-Key" {
		t.Fatalf("apiKey 认证未映射: %+v", c.Auth)
	}
	if len(c.Actions) != 4 {
		t.Fatalf("应生成 4 个动作, got %d", len(c.Actions))
	}
	byID := map[string]json.RawMessage{}
	for _, a := range c.Actions {
		byID[a.ID] = mustJSONAny(t, a)
	}
	// GET → read；operationId 清洗为小写
	if _, ok := byID["tickets.getticket"]; !ok {
		t.Fatalf("缺少 tickets.getticket: %v", keysOf(byID))
	}
	// 无 operationId → method-path slug
	if _, ok := byID["tickets.get-tickets"]; !ok {
		t.Fatalf("缺少 tickets.get-tickets: %v", keysOf(byID))
	}
	// POST → write
	if _, ok := byID["tickets.create-ticket"]; !ok {
		t.Fatalf("缺少 tickets.create-ticket: %v", keysOf(byID))
	}
}

func TestImportOpenAPIOperationTypeAndSchemas(t *testing.T) {
	res, err := ImportOpenAPI([]byte(importDoc), ImportOptions{ConnectorID: "tickets", ConfirmDestructive: true})
	if err != nil {
		t.Fatal(err)
	}
	var get, post, del *struct {
		ID            string
		OperationType string
		InputSchema   map[string]any
		HTTP          struct{ Query, Headers map[string]string }
	}
	_ = get
	_ = post
	_ = del
	for _, a := range res.Connector.Actions {
		switch a.ID {
		case "tickets.getticket":
			if a.OperationType != "read" {
				t.Errorf("GET 应为 read: %s", a.OperationType)
			}
			sch := a.InputSchema
			req, _ := sch["required"].([]any)
			if len(req) != 1 || req[0] != "ticketId" {
				t.Errorf("path 参数应入 required: %v", req)
			}
		case "tickets.get-tickets":
			if a.HTTP.Query["status"] != "{status}" {
				t.Errorf("query 模板不符: %v", a.HTTP.Query)
			}
			if a.HTTP.Headers["X-Request-Source"] != "{X-Request-Source}" {
				t.Errorf("header 模板不符: %v", a.HTTP.Headers)
			}
		case "tickets.create-ticket":
			if a.OperationType != "write" {
				t.Errorf("POST 应为 write: %s", a.OperationType)
			}
			props := a.InputSchema["properties"].(map[string]any)
			if _, ok := props["title"]; !ok {
				t.Errorf("请求体 $ref 属性未合并: %v", props)
			}
			req := a.InputSchema["required"].([]any)
			if len(req) != 1 || req[0] != "title" {
				t.Errorf("请求体 required 未合并: %v", req)
			}
		case "tickets.deleteticket":
			if a.OperationType != "destructive" {
				t.Errorf("DELETE 应为 destructive: %s", a.OperationType)
			}
		}
	}
}

func TestImportOpenAPIDestructiveNeedsConfirm(t *testing.T) {
	_, err := ImportOpenAPI([]byte(importDoc), ImportOptions{ConnectorID: "tickets"})
	list, ok := AsDestructiveNeedsConfirm(err)
	if !ok {
		t.Fatalf("含 DELETE 时应返回待确认错误: %v", err)
	}
	if len(list) != 1 || list[0] != "tickets.deleteticket" {
		t.Fatalf("destructive 列表不符: %v", list)
	}
	// 确认后纳入
	res, err := ImportOpenAPI([]byte(importDoc), ImportOptions{ConnectorID: "tickets", ConfirmDestructive: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Destructive) != 1 || res.Destructive[0] != "tickets.deleteticket" {
		t.Fatalf("确认后应包含 destructive 列表: %v", res.Destructive)
	}
}

func TestImportOpenAPIAuthFallbacks(t *testing.T) {
	// 无 securitySchemes → none
	doc := strings.Replace(importDoc, `"ticketKey": {"type": "apiKey", "in": "header", "name": "X-Ticket-Key"}`, `"ticketKey": {"type": "oauth2", "flows": {}}`, 1)
	res, err := ImportOpenAPI([]byte(doc), ImportOptions{ConnectorID: "tickets", ConfirmDestructive: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Connector.Auth.Type != "none" {
		t.Fatalf("非 apiKey 方案应回退 none: %s", res.Connector.Auth.Type)
	}
}

func TestImportOpenAPIOverrides(t *testing.T) {
	res, err := ImportOpenAPI([]byte(importDoc), ImportOptions{
		ConnectorID:        "tickets",
		DisplayName:        "覆盖名",
		BaseURL:            "https://proxy.internal.example.com/tickets",
		ConfirmDestructive: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Connector.DisplayName != "覆盖名" || res.Connector.BaseURL != "https://proxy.internal.example.com/tickets" {
		t.Fatalf("覆盖未生效: %s / %s", res.Connector.DisplayName, res.Connector.BaseURL)
	}
}

func TestImportOpenAPIErrors(t *testing.T) {
	cases := []struct {
		name string
		opts ImportOptions
		want string
	}{
		{"空 connectorId", ImportOptions{}, "connectorId 不能为空"},
		{"非法 connectorId", ImportOptions{ConnectorID: "Tickets!"}, "不合法"},
	}
	for _, tc := range cases {
		if _, err := ImportOpenAPI([]byte(importDoc), tc.opts); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: 期望错误含 %q, got %v", tc.name, tc.want, err)
		}
	}
	// 无 servers 且未指定 baseUrl
	noServers := strings.Replace(importDoc, `"servers": [{"url": "https://tickets.internal.example.com/v1"}],`, "", 1)
	if _, err := ImportOpenAPI([]byte(noServers), ImportOptions{ConnectorID: "tickets"}); err == nil || !strings.Contains(err.Error(), "baseUrl") {
		t.Errorf("无 servers 应报 baseUrl 错误, got %v", err)
	}
	// 无路径操作
	empty := `{"openapi":"3.0.3","info":{"title":"空"},"servers":[{"url":"https://x.example.com"}],"paths":{}}`
	if _, err := ImportOpenAPI([]byte(empty), ImportOptions{ConnectorID: "tickets"}); err == nil || !strings.Contains(err.Error(), "不含可导入") {
		t.Errorf("空 paths 应报错, got %v", err)
	}
}

func TestImportOpenAPISlugDedup(t *testing.T) {
	doc := `{
	  "openapi": "3.0.3", "info": {"title": "重复"},
	  "servers": [{"url": "https://dup.example.com"}],
	  "paths": {
	    "/a": {"get": {"summary": "同名1"}},
	    "/b": {"get": {"summary": "同名2"}}
	  }
	}`
	res, err := ImportOpenAPI([]byte(doc), ImportOptions{ConnectorID: "dup"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Connector.Actions) != 2 {
		t.Fatalf("应生成 2 个动作, got %d", len(res.Connector.Actions))
	}
	if res.Connector.Actions[0].ID == res.Connector.Actions[1].ID {
		t.Fatal("method+path 生成的动作名应去重")
	}
}

func mustJSONAny(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func keysOf(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
