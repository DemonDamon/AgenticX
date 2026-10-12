package catalog

import (
	"encoding/json"
	"testing"

	"github.com/agenticx/connector-runtime/internal/model"
)

func testConnector(id, title string) *model.Connector {
	return &model.Connector{
		ID:          id,
		DisplayName: title,
		Categories:  []string{"devtools"},
		BaseURL:     "https://" + id + ".example",
		Auth:        model.AuthSpec{Type: model.AuthNone},
		Actions: []model.Action{
			{ID: id + ".get", Title: "查询数据", Description: "按 id 查询", OperationType: "read",
				InputSchema: map[string]any{"type": "object"},
				HTTP:        model.HTTPAction{Method: "GET", Path: "/get"}},
			{ID: id + ".purge", Title: "清除", OperationType: "destructive",
				RequiredScopes: []string{"admin"},
				HTTP:           model.HTTPAction{Method: "DELETE", Path: "/all"}},
		},
	}
}

func newTestStore(t *testing.T, cs ...*model.Connector) *Store {
	t.Helper()
	s, err := New(cs)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s
}

func TestNewDuplicateConnectorID(t *testing.T) {
	if _, err := New([]*model.Connector{testConnector("a", "A"), testConnector("a", "A2")}); err == nil {
		t.Fatal("重复连接器 id 应报错")
	}
}

func TestAppsProjection(t *testing.T) {
	s := newTestStore(t, testConnector("b", "B"), testConnector("a", "A"))
	apps := s.Apps()
	if len(apps) != 2 || apps[0].ID != "a" || apps[1].ID != "b" {
		t.Fatalf("Apps 应按 id 排序: %+v", apps)
	}
	if apps[0].ActionCount != 2 || apps[0].AuthType != "none" {
		t.Fatalf("投影字段不符: %+v", apps[0])
	}
	// 投影不得携带 schema / 执行细节
	raw, _ := json.Marshal(apps[0])
	for _, banned := range []string{"inputSchema", "http", "baseUrl"} {
		if string(raw) != "" && containsSub(string(raw), banned) {
			t.Fatalf("投影泄漏执行细节 %s: %s", banned, raw)
		}
	}
}

func containsSub(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}

func TestSearch(t *testing.T) {
	s := newTestStore(t, testConnector("httpbin", "HTTPBin"))
	cases := []struct {
		name, query, connectorID string
		wantIDs                  []string
	}{
		{"空查询返回全部", "", "", []string{"httpbin.get", "httpbin.purge"}},
		{"按动作 id 命中", "get", "", []string{"httpbin.get"}},
		{"按标题命中", "清除", "", []string{"httpbin.purge"}},
		{"按描述命中", "按 id", "", []string{"httpbin.get"}},
		{"按分类命中", "devtools", "", []string{"httpbin.get", "httpbin.purge"}},
		{"大小写不敏感", "HTTPBIN.PURGE", "", []string{"httpbin.purge"}},
		{"无命中", "nomatch", "", nil},
		{"按连接器过滤", "", "other", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := s.Actions(tc.query, tc.connectorID)
			if len(got) != len(tc.wantIDs) {
				t.Fatalf("命中数 %d != 期望 %d: %+v", len(got), len(tc.wantIDs), got)
			}
			for i, id := range tc.wantIDs {
				if got[i].ID != id {
					t.Fatalf("第 %d 个结果 %s != %s", i, got[i].ID, id)
				}
				if got[i].ConnectorID != "httpbin" {
					t.Fatalf("ConnectorID 缺失: %+v", got[i])
				}
			}
		})
	}
	// ActionSummary 不含 schema
	raw, _ := json.Marshal(s.Actions("", ""))
	if containsSub(string(raw), "inputSchema") {
		t.Fatalf("动作投影泄漏 schema: %s", raw)
	}
}

func TestActionLookup(t *testing.T) {
	s := newTestStore(t, testConnector("httpbin", "HTTPBin"))
	a, c, ok := s.Action("httpbin.purge")
	if !ok || a.OperationType != "destructive" || c.ID != "httpbin" {
		t.Fatalf("查找失败: %+v %+v %v", a, c, ok)
	}
	if _, _, ok := s.Action("nope.get"); ok {
		t.Fatal("未知动作不应命中")
	}
}

func TestETagStability(t *testing.T) {
	s1 := newTestStore(t, testConnector("b", "B"), testConnector("a", "A"))
	s2 := newTestStore(t, testConnector("a", "A"), testConnector("b", "B")) // 顺序不同
	if s1.ETag() != s2.ETag() {
		t.Fatalf("内容相同顺序不同，ETag 应一致: %s vs %s", s1.ETag(), s2.ETag())
	}
	s3 := newTestStore(t, testConnector("a", "A"), testConnector("c", "C"))
	if s1.ETag() == s3.ETag() {
		t.Fatal("内容不同，ETag 应不同")
	}
	if s1.ETag() == "" {
		t.Fatal("ETag 不应为空")
	}
}
