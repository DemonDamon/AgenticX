package mcphost

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	connectorapi "github.com/agenticx/connector-runtime/api"
	"github.com/agenticx/enterprise/gateway/internal/audit"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

// ---- 测试替身 ----

type fakeConnectorStore struct {
	defs  []*connectorapi.Connector
	conns *fakeAPIConnections
}

func (f *fakeConnectorStore) ListDefinitions(context.Context, string) ([]*connectorapi.Connector, error) {
	return f.defs, nil
}

func (f *fakeConnectorStore) ConnectionsFor(string) connectorapi.Connections { return f.conns }

type fakeAPIConnections struct {
	items  []connectorapi.ConnectionProjection
	secret connectorapi.ConnectionSecret
}

func (f *fakeAPIConnections) List(context.Context) []connectorapi.ConnectionProjection {
	return f.items
}

func (f *fakeAPIConnections) Get(_ context.Context, id string) (connectorapi.ConnectionProjection, bool) {
	for _, p := range f.items {
		if p.ID == id {
			return p, true
		}
	}
	return connectorapi.ConnectionProjection{}, false
}

func (f *fakeAPIConnections) Reveal(context.Context, string) (connectorapi.ConnectionSecret, error) {
	return f.secret, nil
}

// keyedConnector api_key 认证连接器（上游为 httptest 环回地址）。
func keyedConnector(baseURL string) *connectorapi.Connector {
	return &connectorapi.Connector{
		ID: "keyed", DisplayName: "Keyed App", BaseURL: baseURL,
		Auth: connectorapi.AuthSpec{Type: connectorapi.AuthAPIKey, APIKey: &connectorapi.APIKeyAuth{In: "header", Name: "X-API-Key"}},
		Actions: []connectorapi.Action{{
			ID: "keyed.fetch", Title: "Fetch", OperationType: "read",
			RequiredScopes: []string{"read"},
			HTTP:           connectorapi.HTTPAction{Method: "GET", Path: "/secure"},
		}},
	}
}

func keyedBackend(upstream *httptest.Server) *ConnectorBackend {
	store := &fakeConnectorStore{
		defs: []*connectorapi.Connector{keyedConnector(upstream.URL)},
		conns: &fakeAPIConnections{
			items: []connectorapi.ConnectionProjection{{
				ID: "conn-1", ConnectorID: "keyed", Name: "测试连接", AuthType: "api_key",
				GrantedScopes: []string{"read"},
			}},
			secret: connectorapi.ConnectionSecret{APIKey: "sk-test"},
		},
	}
	// httptest 监听环回地址，须放开私网限制才能连通。
	return NewConnectorBackend(store, nil, true)
}

func connectorRecord() *ServerRecord {
	return &ServerRecord{
		Name: "connector", TenantID: "tenant-a", Transport: "streamable-http",
		BackendType: BackendConnector, Status: "active",
	}
}

// ---- backend 工具面 ----

func TestConnectorBackendListTools(t *testing.T) {
	b := NewConnectorBackend(&fakeConnectorStore{}, nil, false)
	tools, err := b.ListTools(context.Background(), connectorRecord())
	if err != nil {
		t.Fatal(err)
	}
	if len(tools) != 5 {
		t.Fatalf("want 5 tools, got %d", len(tools))
	}
	want := []string{"list_apps", "list_connections", "search_actions", "get_action_guide", "execute_action"}
	for i, tl := range tools {
		if tl.Name != want[i] {
			t.Errorf("tools[%d].Name = %q, want %q", i, tl.Name, want[i])
		}
		if !json.Valid(tl.InputSchema) {
			t.Errorf("tools[%d].InputSchema 非法 JSON", i)
		}
	}
}

func TestConnectorBackendExecuteActionOK(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "sk-test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path != "/secure" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer up.Close()

	b := keyedBackend(up)
	res, err := b.CallTool(context.Background(), connectorRecord(), "execute_action", map[string]any{
		"actionId": "keyed.fetch", "connectionId": "conn-1", "input": map[string]any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.IsError {
		t.Fatalf("执行失败: %s", res.Content[0].Text)
	}
	m := res.Metadata
	if m == nil {
		t.Fatal("Metadata 缺失（审计维度无法贯穿）")
	}
	if id, _ := m["connector_execution_id"].(string); !strings.HasPrefix(id, "exec-") {
		t.Errorf("connector_execution_id 缺失: %v", m)
	}
	if m["connector_action_id"] != "keyed.fetch" || m["connector_id"] != "keyed" {
		t.Errorf("动作维度不符: %v", m)
	}
	if m["connector_connection_id"] != "conn-1" {
		t.Errorf("连接维度不符: %v", m)
	}
	if m["connector_status"] != connectorapi.AuditStatusOK {
		t.Errorf("状态不符: %v", m)
	}
	// 凭据不得出现在结果文本中
	if strings.Contains(res.Content[0].Text, "sk-test") {
		t.Fatal("结果泄漏凭据")
	}
}

func TestConnectorBackendExecuteActionMissingConnection(t *testing.T) {
	b := keyedBackend(httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	res, err := b.CallTool(context.Background(), connectorRecord(), "execute_action", map[string]any{
		"actionId": "keyed.fetch", // api_key 连接器缺 connectionId
	})
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsError {
		t.Fatal("缺连接应返回工具级错误")
	}
	if res.Metadata["connector_error_code"] != "connection_not_found" {
		t.Errorf("错误码不符: %v", res.Metadata)
	}
	if res.Metadata["connector_status"] != connectorapi.AuditStatusDenied {
		t.Errorf("状态应为 denied: %v", res.Metadata)
	}
}

func TestConnectorBackendStoreUnavailable(t *testing.T) {
	b := NewConnectorBackend(nil, nil, true)
	res, err := b.CallTool(context.Background(), connectorRecord(), "list_apps", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsError {
		t.Fatal("存储不可用应返回工具级错误")
	}
}

func TestConnectorAllowPrivateNetwork(t *testing.T) {
	os.Unsetenv(AllowPrivateNetworkEnv)
	if connectorAllowPrivateNetwork() {
		t.Fatal("默认应拒绝私网")
	}
	for _, v := range []string{"on", "1", "true", "TRUE"} {
		t.Setenv(AllowPrivateNetworkEnv, v)
		if !connectorAllowPrivateNetwork() {
			t.Fatalf("%s 应放行私网", v)
		}
	}
	t.Setenv(AllowPrivateNetworkEnv, "off")
	if connectorAllowPrivateNetwork() {
		t.Fatal("off 应拒绝私网")
	}
}

// ---- 宿主管线：connector 策略阶段与审计贯穿 ----

func readAuditEvents(t *testing.T, dir string) []audit.Event {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	out := []audit.Event{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
			if line == "" {
				continue
			}
			var ev audit.Event
			if err := json.Unmarshal([]byte(line), &ev); err != nil {
				t.Fatal(err)
			}
			out = append(out, ev)
		}
	}
	return out
}

func connectorHost(t *testing.T, dir string, blockAction string) *Host {
	t.Helper()
	host := NewHost(nil, nil, nil, audit.NewFileWriter(dir), func(text string, ec policyengine.EvalContext) policyengine.EvaluateResult {
		if ec.Stage == "connector" && text == blockAction {
			return policyengine.EvaluateResult{Blocked: true}
		}
		return policyengine.EvaluateResult{}
	})
	host.backends[BackendConnector] = keyedBackend(httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	})))
	return host
}

func TestConnectorStagePolicyBlocksBeforeExecution(t *testing.T) {
	dir := t.TempDir()
	host := connectorHost(t, dir, "keyed.fetch")
	identity := Identity{TenantID: "tenant-a", UserID: "user-a", Scopes: []string{"mcp:*"}}
	args := map[string]any{"actionId": "keyed.fetch", "connectionId": "conn-1"}

	_, status, err := host.invokeTool(context.Background(), connectorRecord(), identity, "execute_action", args)
	if status != "blocked" || err == nil || err.Error() != "policy:blocked" {
		t.Fatalf("应被策略拦截: status=%q err=%v", status, err)
	}
	events := readAuditEvents(t, dir)
	if len(events) != 1 {
		t.Fatalf("应有 1 条审计事件, got %d", len(events))
	}
	ev := events[0]
	if ev.MCPStatus != "blocked" {
		t.Errorf("MCPStatus = %q, want blocked", ev.MCPStatus)
	}
	if ev.ConnectorActionID != "keyed.fetch" {
		t.Errorf("ConnectorActionID = %q, want keyed.fetch", ev.ConnectorActionID)
	}
	if ev.ConnectorConnectionID != "conn-1" {
		t.Errorf("ConnectorConnectionID = %q, want conn-1", ev.ConnectorConnectionID)
	}
	if ev.MCPServer != "connector" || ev.MCPToolName != "execute_action" {
		t.Errorf("事件维度不符: %s / %s", ev.MCPServer, ev.MCPToolName)
	}
}

func TestConnectorStageAuditCarriesExecutionID(t *testing.T) {
	dir := t.TempDir()
	host := connectorHost(t, dir, "") // 无拦截
	identity := Identity{TenantID: "tenant-a", UserID: "user-a", Scopes: []string{"mcp:*"}}
	args := map[string]any{"actionId": "keyed.fetch", "connectionId": "conn-1", "input": map[string]any{}}

	res, status, err := host.invokeTool(context.Background(), connectorRecord(), identity, "execute_action", args)
	if status != "ok" || err != nil || res.IsError {
		t.Fatalf("执行应成功: status=%q err=%v isError=%v", status, err, res.IsError)
	}
	events := readAuditEvents(t, dir)
	if len(events) != 1 {
		t.Fatalf("应有 1 条审计事件, got %d", len(events))
	}
	ev := events[0]
	if ev.MCPStatus != "ok" {
		t.Errorf("MCPStatus = %q, want ok", ev.MCPStatus)
	}
	if !strings.HasPrefix(ev.ConnectorExecutionID, "exec-") {
		t.Errorf("ConnectorExecutionID 缺失: %q", ev.ConnectorExecutionID)
	}
	if ev.ConnectorActionID != "keyed.fetch" || ev.ConnectorConnectionID != "conn-1" {
		t.Errorf("动作/连接维度不符: %q / %q", ev.ConnectorActionID, ev.ConnectorConnectionID)
	}
}
