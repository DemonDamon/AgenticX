package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/agenticx/connector-runtime/internal/audit"
	"github.com/agenticx/connector-runtime/internal/connection"
	"github.com/agenticx/connector-runtime/internal/policy"
)

// ---- 测试替身 ----

type fakeConns struct {
	items  []connection.Projection
	secret map[string]connection.Secret
	fail   map[string]error
}

func (f *fakeConns) List(context.Context) []connection.Projection { return f.items }

func (f *fakeConns) Get(_ context.Context, id string) (connection.Projection, bool) {
	for _, p := range f.items {
		if p.ID == id {
			return p, true
		}
	}
	return connection.Projection{}, false
}

func (f *fakeConns) Reveal(_ context.Context, id string) (connection.Secret, error) {
	if err, ok := f.fail[id]; ok {
		return connection.Secret{}, err
	}
	sec, ok := f.secret[id]
	if !ok {
		return connection.Secret{}, os.ErrNotExist
	}
	return sec, nil
}

type fakePolicy struct{ block map[string]bool }

func (f fakePolicy) Evaluate(actionID string) policy.Decision {
	if f.block[actionID] {
		return policy.Decision{Allowed: false, Code: "action_blocked", Reason: "命中阻止规则"}
	}
	return policy.Decision{Allowed: true}
}

type fakeAudit struct {
	mu      sync.Mutex
	entries []audit.Entry
}

func (f *fakeAudit) Log(e audit.Entry) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.entries = append(f.entries, e)
	return nil
}

func newTestTools(t *testing.T, conns Connections, pol ActionPolicy, aud AuditSink, connectors ...*Connector) *Tools {
	t.Helper()
	cat, err := NewCatalog(connectors)
	if err != nil {
		t.Fatal(err)
	}
	exec := NewExecutor(ExecOptions{AllowPrivateNetwork: true})
	return NewTools(cat, conns, pol, exec, aud)
}

func noAuthConnector(baseURL string) *Connector {
	return &Connector{
		ID: "plain", DisplayName: "Plain App", BaseURL: baseURL,
		Auth: AuthSpec{Type: AuthNone},
		Actions: []Action{{
			ID: "plain.get", Title: "Get", OperationType: "read",
			HTTP: HTTPAction{Method: "GET", Path: "/data"},
		}},
	}
}

func apiKeyConnector(baseURL string) *Connector {
	return &Connector{
		ID: "keyed", DisplayName: "Keyed App", BaseURL: baseURL,
		Auth: AuthSpec{Type: AuthAPIKey, APIKey: &APIKeyAuth{In: "header", Name: "X-API-Key"}},
		Actions: []Action{{
			ID: "keyed.fetch", Title: "Fetch", OperationType: "read",
			RequiredScopes: []string{"read"},
			HTTP:           HTTPAction{Method: "GET", Path: "/secure"},
		}},
	}
}

// ---- 工具定义 ----

func TestDefinitionsFiveTools(t *testing.T) {
	defs := Definitions()
	if len(defs) != 5 {
		t.Fatalf("want 5 tools, got %d", len(defs))
	}
	want := []string{"list_apps", "list_connections", "search_actions", "get_action_guide", "execute_action"}
	for i, d := range defs {
		if d.Name != want[i] {
			t.Errorf("defs[%d].Name = %q, want %q", i, d.Name, want[i])
		}
		if d.InputSchema == nil {
			t.Errorf("defs[%d].InputSchema missing", i)
		}
	}
}

// ---- 发现型工具 ----

func TestListAppsAndSearch(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	}))
	defer up.Close()

	tools := newTestTools(t, nil, nil, nil, noAuthConnector(up.URL), apiKeyConnector(up.URL))
	ctx := context.Background()

	res, perr := tools.Call(ctx, "list_apps", nil)
	if perr != nil || res.IsError {
		t.Fatalf("list_apps failed: %+v %+v", res, perr)
	}
	var apps []AppSummary
	if err := json.Unmarshal([]byte(res.Text), &apps); err != nil {
		t.Fatal(err)
	}
	if len(apps) != 2 || apps[0].ID != "keyed" || apps[1].ID != "plain" {
		t.Fatalf("apps = %+v", apps)
	}

	res, perr = tools.Call(ctx, "search_actions", map[string]any{"query": "FETCH"})
	if perr != nil {
		t.Fatalf("search_actions protocol error: %+v", perr)
	}
	var acts []ActionSummary
	if err := json.Unmarshal([]byte(res.Text), &acts); err != nil {
		t.Fatal(err)
	}
	if len(acts) != 1 || acts[0].ID != "keyed.fetch" {
		t.Fatalf("acts = %+v", acts)
	}

	if _, perr = tools.Call(ctx, "search_actions", map[string]any{"connectorId": "nope"}); perr == nil || perr.Code != CodeInvalidParams {
		t.Fatalf("unknown connectorId should be protocol error, got %+v", perr)
	}
}

func TestListConnections(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	}))
	defer up.Close()

	conns := &fakeConns{items: []connection.Projection{{ID: "conn-1", ConnectorID: "plain", Name: "n"}}}
	tools := newTestTools(t, conns, nil, nil, noAuthConnector(up.URL))
	res, perr := tools.Call(context.Background(), "list_connections", nil)
	if perr != nil || res.IsError {
		t.Fatalf("list_connections failed: %+v", res)
	}
	var list []connection.Projection
	if err := json.Unmarshal([]byte(res.Text), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != "conn-1" {
		t.Fatalf("list = %+v", list)
	}
}

func TestGetActionGuide(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	}))
	defer up.Close()

	tools := newTestTools(t, nil, nil, nil, noAuthConnector(up.URL))
	ctx := context.Background()

	res, _ := tools.Call(ctx, "get_action_guide", map[string]any{"actionId": "plain.get"})
	if res.IsError {
		t.Fatalf("guide failed: %s", res.Text)
	}
	var guide map[string]any
	if err := json.Unmarshal([]byte(res.Text), &guide); err != nil {
		t.Fatal(err)
	}
	if guide["id"] != "plain.get" {
		t.Fatalf("guide = %+v", guide)
	}

	res, _ = tools.Call(ctx, "get_action_guide", map[string]any{"actionId": "plain.missing"})
	if !res.IsError {
		t.Fatalf("unknown action should be error result: %s", res.Text)
	}

	if _, perr := tools.Call(ctx, "get_action_guide", map[string]any{}); perr == nil || perr.Code != CodeInvalidParams {
		t.Fatalf("missing actionId should be protocol error, got %+v", perr)
	}
}

func TestUnknownTool(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer up.Close()
	tools := newTestTools(t, nil, nil, nil, noAuthConnector(up.URL))
	if _, perr := tools.Call(context.Background(), "nope", nil); perr == nil || perr.Code != CodeInvalidParams {
		t.Fatalf("got %+v", perr)
	}
}

// ---- execute_action ----

func TestExecuteActionSuccess(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/data" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer up.Close()

	aud := &fakeAudit{}
	tools := newTestTools(t, nil, nil, aud, noAuthConnector(up.URL))
	res, perr := tools.Call(context.Background(), "execute_action", map[string]any{"actionId": "plain.get"})
	if perr != nil {
		t.Fatalf("protocol error: %+v", perr)
	}
	if res.IsError {
		t.Fatalf("execute failed: %s", res.Text)
	}
	var payload struct {
		ExecutionID string          `json:"executionId"`
		StatusCode  int             `json:"statusCode"`
		Body        json.RawMessage `json:"body"`
	}
	if err := json.Unmarshal([]byte(res.Text), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ExecutionID == "" || payload.StatusCode != 200 || string(payload.Body) != `{"ok":true}` {
		t.Fatalf("payload = %+v", payload)
	}
	if res.Exec == nil || res.Exec.ExecutionID != payload.ExecutionID || res.Exec.Status != audit.StatusOK {
		t.Fatalf("exec record = %+v", res.Exec)
	}
	if len(aud.entries) != 1 || aud.entries[0].Status != audit.StatusOK || aud.entries[0].Action != "plain.get" {
		t.Fatalf("audit = %+v", aud.entries)
	}
}

func TestExecuteActionDeniedPaths(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	}))
	defer up.Close()
	ctx := context.Background()

	cases := []struct {
		name    string
		conns   Connections
		pol     ActionPolicy
		args    map[string]any
		wantErr string
	}{
		{"unknown action", nil, nil, map[string]any{"actionId": "plain.none"}, "unknown_action"},
		{"action blocked", nil, fakePolicy{block: map[string]bool{"plain.get": true}},
			map[string]any{"actionId": "plain.get"}, "action_blocked"},
		{"missing connection", &fakeConns{}, nil,
			map[string]any{"actionId": "keyed.fetch"}, "connection_not_found"},
		{"connection of other connector", &fakeConns{items: []connection.Projection{{ID: "c1", ConnectorID: "plain"}}}, nil,
			map[string]any{"actionId": "keyed.fetch", "connectionId": "c1"}, "connection_not_found"},
		{"secret unavailable", &fakeConns{
			items:  []connection.Projection{{ID: "c1", ConnectorID: "keyed"}},
			fail:   map[string]error{"c1": errors.New("boom")},
		}, nil,
			map[string]any{"actionId": "keyed.fetch", "connectionId": "c1"}, "connection_not_found"},
		{"scope denied", &fakeConns{
			items:  []connection.Projection{{ID: "c1", ConnectorID: "keyed"}},
			secret: map[string]connection.Secret{"c1": {APIKey: "k"}},
		}, nil,
			map[string]any{"actionId": "keyed.fetch", "connectionId": "c1"}, "scope_denied"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tools := newTestTools(t, tc.conns, tc.pol, nil, noAuthConnector(up.URL), apiKeyConnector(up.URL))
			res, perr := tools.Call(ctx, "execute_action", tc.args)
			if perr != nil {
				t.Fatalf("protocol error: %+v", perr)
			}
			if !res.IsError {
				t.Fatalf("expected error result, got %s", res.Text)
			}
			var payload map[string]any
			if err := json.Unmarshal([]byte(res.Text), &payload); err != nil {
				t.Fatal(err)
			}
			errObj, _ := payload["error"].(map[string]any)
			if errObj["code"] != tc.wantErr {
				t.Fatalf("error code = %v, want %s (text=%s)", errObj["code"], tc.wantErr, res.Text)
			}
			if res.Exec == nil || res.Exec.Status != audit.StatusDenied || res.Exec.ErrorCode != tc.wantErr {
				t.Fatalf("exec record = %+v", res.Exec)
			}
		})
	}
}

func TestExecuteActionWithCredentialsAndScopes(t *testing.T) {
	var gotKey, gotPath string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("X-API-Key")
		gotPath = r.URL.Path
		_, _ = w.Write([]byte(`{"fine":1}`))
	}))
	defer up.Close()

	conns := &fakeConns{
		items:  []connection.Projection{{ID: "c1", ConnectorID: "keyed", GrantedScopes: []string{"read"}}},
		secret: map[string]connection.Secret{"c1": {APIKey: "secret-key"}},
	}
	tools := newTestTools(t, conns, nil, nil, apiKeyConnector(up.URL))
	res, perr := tools.Call(context.Background(), "execute_action",
		map[string]any{"actionId": "keyed.fetch", "connectionId": "c1"})
	if perr != nil {
		t.Fatalf("protocol error: %+v", perr)
	}
	if res.IsError {
		t.Fatalf("execute failed: %s", res.Text)
	}
	if gotKey != "secret-key" || gotPath != "/secure" {
		t.Fatalf("upstream saw key=%q path=%q", gotKey, gotPath)
	}
	if res.Exec == nil || res.Exec.ConnectionID != "c1" || res.Exec.ConnectorID != "keyed" {
		t.Fatalf("exec record = %+v", res.Exec)
	}
}

func TestExecuteActionMissingActionID(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer up.Close()
	tools := newTestTools(t, nil, nil, nil, noAuthConnector(up.URL))
	if _, perr := tools.Call(context.Background(), "execute_action", map[string]any{}); perr == nil || perr.Code != CodeInvalidParams {
		t.Fatalf("got %+v", perr)
	}
}
