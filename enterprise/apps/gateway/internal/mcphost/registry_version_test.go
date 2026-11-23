package mcphost

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// 托管 MCP 版本读路径。假驱动跑真实 SQL（含 Rebind），不引入第三方 mock。

type regServerRow struct {
	id, tenant, name, display, transport, backendType, status string
	backend, scopes, rate                                     []byte
	publishedID                                               string
}

type regToolRow struct {
	serverID, name, desc, sourceOp string
	input, output, metadata        []byte
	enabled                        bool
}

type regVersionRow struct {
	id, serverID, shelf string
	tools, backend      []byte
}

type regMem struct {
	mu       sync.Mutex
	queries  []string
	servers  []regServerRow
	tools    []regToolRow
	versions []regVersionRow
}

type regStubDriver struct{}
type regStubConn struct{ mem *regMem }
type regStubRows struct {
	cols []string
	data [][]driver.Value
	next int
}

var (
	regStubOnce  sync.Once
	regStubByDSN sync.Map
)

func (regStubDriver) Open(name string) (driver.Conn, error) {
	value, ok := regStubByDSN.Load(name)
	if !ok {
		return nil, errors.New("unknown registry stub: " + name)
	}
	return &regStubConn{mem: value.(*regMem)}, nil
}

func (c *regStubConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (c *regStubConn) Close() error                        { return nil }
func (c *regStubConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }

func (c *regStubConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.mem.mu.Lock()
	c.mem.queries = append(c.mem.queries, query)
	c.mem.mu.Unlock()
	switch {
	case strings.Contains(query, "mcp_server_versions"):
		if !strings.Contains(query, "shelf_status = 'published'") {
			return nil, errors.New("published version query must filter shelf_status")
		}
		return versionRows(c.mem, argString(args, 0)), nil
	case strings.Contains(query, "mcp_tools"):
		return toolRows(c.mem, argString(args, 0)), nil
	case strings.Contains(query, "FROM mcp_servers") && strings.Contains(query, "name ="):
		return serverByNameRows(c.mem, argString(args, 0), argString(args, 1)), nil
	case strings.Contains(query, "FROM mcp_servers"):
		return serverListRows(c.mem, argString(args, 0)), nil
	default:
		return nil, errors.New("unexpected query: " + query)
	}
}

func (r *regStubRows) Columns() []string { return r.cols }
func (r *regStubRows) Close() error      { return nil }
func (r *regStubRows) Next(dest []driver.Value) error {
	if r.next >= len(r.data) {
		return io.EOF
	}
	row := r.data[r.next]
	r.next++
	for i := range dest {
		if i < len(row) {
			dest[i] = row[i]
		}
	}
	return nil
}

func argString(args []driver.NamedValue, i int) string {
	if i >= len(args) || args[i].Value == nil {
		return ""
	}
	return strings.TrimSpace(args[i].Value.(string))
}

func nullString(value string) driver.Value {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func serverByNameRows(mem *regMem, tenant, name string) driver.Rows {
	cols := []string{"id", "display_name", "transport", "backend_type", "backend_config", "required_scopes", "status", "rate_limit", "published_version_id"}
	var data [][]driver.Value
	for _, server := range mem.servers {
		if server.tenant == tenant && server.name == name && server.status == "active" {
			data = append(data, serverValues(server, false))
		}
	}
	return &regStubRows{cols: cols, data: data}
}

func serverListRows(mem *regMem, tenant string) driver.Rows {
	cols := []string{"id", "name", "display_name", "transport", "backend_type", "backend_config", "required_scopes", "status", "rate_limit", "published_version_id"}
	var data [][]driver.Value
	for _, server := range mem.servers {
		if server.tenant == tenant && server.status == "active" {
			data = append(data, serverValues(server, true))
		}
	}
	return &regStubRows{cols: cols, data: data}
}

func serverValues(server regServerRow, includeName bool) []driver.Value {
	head := []driver.Value{server.id}
	if includeName {
		head = append(head, server.name)
	}
	return append(head,
		server.display,
		server.transport,
		server.backendType,
		append([]byte(nil), server.backend...),
		append([]byte(nil), server.scopes...),
		server.status,
		append([]byte(nil), server.rate...),
		nullString(server.publishedID),
	)
}

func toolRows(mem *regMem, serverID string) driver.Rows {
	cols := []string{"tool_name", "description", "input_schema", "output_schema", "enabled", "metadata", "source_operation_id"}
	var data [][]driver.Value
	for _, tool := range mem.tools {
		if tool.serverID != serverID || !tool.enabled {
			continue
		}
		var output driver.Value
		if len(tool.output) > 0 {
			output = append([]byte(nil), tool.output...)
		}
		data = append(data, []driver.Value{
			tool.name,
			tool.desc,
			append([]byte(nil), tool.input...),
			output,
			tool.enabled,
			append([]byte(nil), tool.metadata...),
			tool.sourceOp,
		})
	}
	return &regStubRows{cols: cols, data: data}
}

func versionRows(mem *regMem, id string) driver.Rows {
	cols := []string{"tools_json", "backend_config_json"}
	var data [][]driver.Value
	for _, version := range mem.versions {
		if version.id == id && version.shelf == "published" {
			data = append(data, []driver.Value{
				append([]byte(nil), version.tools...),
				append([]byte(nil), version.backend...),
			})
		}
	}
	return &regStubRows{cols: cols, data: data}
}

func openRegMem(t *testing.T, dialect database.Dialect, mem *regMem) (*Registry, *Host, *regMem) {
	t.Helper()
	regStubOnce.Do(func() { sql.Register("mcp-registry-version", regStubDriver{}) })
	dsn := t.Name() + "/" + string(dialect)
	regStubByDSN.Store(dsn, mem)
	t.Cleanup(func() { regStubByDSN.Delete(dsn) })
	db, err := sql.Open("mcp-registry-version", dsn)
	if err != nil {
		t.Fatalf("open stub: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	handle := &database.Handle{Dialect: dialect, DB: db}
	return NewRegistry(handle, nil), NewHost(handle, nil, nil, nil, nil), mem
}

func queriesContain(mem *regMem, fragment string) bool {
	mem.mu.Lock()
	defer mem.mu.Unlock()
	for _, query := range mem.queries {
		if strings.Contains(query, fragment) {
			return true
		}
	}
	return false
}

func resetQueries(mem *regMem) {
	mem.mu.Lock()
	mem.queries = nil
	mem.mu.Unlock()
}

func listedToolNames(t *testing.T, host *Host, rec *ServerRecord) []string {
	t.Helper()
	resp := host.dispatchRPC(context.Background(), rec, Identity{Scopes: []string{"mcp:*"}}, jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "tools/list",
	})
	if resp.Error != nil {
		t.Fatalf("tools/list error: %+v", resp.Error)
	}
	body, ok := resp.Result.(map[string]any)
	if !ok {
		t.Fatalf("result type %T", resp.Result)
	}
	raw, _ := json.Marshal(body["tools"])
	var items []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, item.Name)
	}
	return names
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func testTool(name string, enabled bool) map[string]any {
	return map[string]any{
		"tool_name":           name,
		"description":         name + " desc",
		"input_schema":        map[string]any{"type": "object"},
		"output_schema":       nil,
		"enabled":             enabled,
		"source_operation_id": name,
		"metadata":            map[string]any{},
	}
}

func TestRegistryStockServerKeepsLiveTools(t *testing.T) {
	for _, dialect := range []database.Dialect{database.MySQL, database.PostgreSQL} {
		t.Run(string(dialect), func(t *testing.T) {
			mem := &regMem{
				servers: []regServerRow{{
					id: "srv-stock", tenant: "tenant-a", name: "pets", display: "Pets",
					transport: "streamable-http", backendType: BackendOpenAPI, status: "active",
					backend: mustJSON(t, map[string]any{"base_url": "https://live.example"}),
					scopes:  mustJSON(t, []string{"mcp:read"}),
					rate:    mustJSON(t, map[string]any{"tool_calls_per_minute": 30}),
				}},
				tools: []regToolRow{{
					serverID: "srv-stock", name: "legacy", desc: "from table",
					input: mustJSON(t, map[string]any{"type": "object"}), metadata: []byte(`{}`), enabled: true,
				}},
				versions: []regVersionRow{{
					id: "ver-draft", serverID: "srv-stock", shelf: "draft",
					tools:   mustJSON(t, []map[string]any{testTool("draftOnly", true)}),
					backend: mustJSON(t, map[string]any{"base_url": "https://draft.example"}),
				}},
			}
			registry, host, mem := openRegMem(t, dialect, mem)
			rec, err := registry.GetByName(context.Background(), "tenant-a", "pets")
			if err != nil {
				t.Fatal(err)
			}
			if queriesContain(mem, "mcp_server_versions") {
				t.Fatal("stock server queried mcp_server_versions")
			}
			if rec.ToolsFromPublishedVersion {
				t.Fatal("stock server marked as published version")
			}
			if rec.BackendConfig["base_url"] != "https://live.example" {
				t.Fatalf("backend = %#v", rec.BackendConfig)
			}
			if rec.ToolCallsPerMin != 30 || len(rec.RequiredScopes) != 1 || rec.RequiredScopes[0] != "mcp:read" {
				t.Fatalf("scan misaligned: rpm=%d scopes=%v", rec.ToolCallsPerMin, rec.RequiredScopes)
			}
			if got := listedToolNames(t, host, rec); len(got) != 1 || got[0] != "legacy" {
				t.Fatalf("tools/list = %v", got)
			}
		})
	}
}

func TestRegistryPublishedVersionHidesDraftTools(t *testing.T) {
	for _, dialect := range []database.Dialect{database.MySQL, database.PostgreSQL} {
		t.Run(string(dialect), func(t *testing.T) {
			mem := &regMem{
				servers: []regServerRow{{
					id: "srv-pub", tenant: "tenant-a", name: "pets", display: "Pets",
					transport: "streamable-http", backendType: BackendOpenAPI, status: "active",
					backend:     mustJSON(t, map[string]any{"base_url": "https://table.example"}),
					scopes:      []byte(`[]`),
					rate:        mustJSON(t, map[string]any{"tool_calls_per_minute": 12}),
					publishedID: "ver-live",
				}},
				tools: []regToolRow{{
					serverID: "srv-pub", name: "fromTable", desc: "should not list",
					input: []byte(`{"type":"object"}`), metadata: []byte(`{}`), enabled: true,
				}},
				versions: []regVersionRow{
					{
						id: "ver-live", serverID: "srv-pub", shelf: "published",
						tools: mustJSON(t, []map[string]any{
							testTool("zeta", true),
							testTool("hidden", false),
							testTool("alpha", true),
						}),
						backend: mustJSON(t, map[string]any{"base_url": "https://published.example"}),
					},
					{
						id: "ver-draft", serverID: "srv-pub", shelf: "draft",
						tools:   mustJSON(t, []map[string]any{testTool("draftOnly", true)}),
						backend: mustJSON(t, map[string]any{"base_url": "https://draft.example"}),
					},
				},
			}
			registry, host, mem := openRegMem(t, dialect, mem)
			rec, err := registry.GetByName(context.Background(), "tenant-a", "pets")
			if err != nil {
				t.Fatal(err)
			}
			if queriesContain(mem, "mcp_tools") {
				t.Fatal("published server fell back to mcp_tools")
			}
			if !rec.ToolsFromPublishedVersion {
				t.Fatal("expected published version surface")
			}
			if rec.BackendConfig["base_url"] != "https://published.example" {
				t.Fatalf("backend = %#v", rec.BackendConfig)
			}
			if rec.ToolCallsPerMin != 12 {
				t.Fatalf("rpm = %d", rec.ToolCallsPerMin)
			}
			if got := listedToolNames(t, host, rec); len(got) != 2 || got[0] != "alpha" || got[1] != "zeta" {
				t.Fatalf("tools/list = %v, want [alpha zeta]", got)
			}
		})
	}
}

func TestRegistryEmptyPublishedVersionDoesNotExposeSpecTools(t *testing.T) {
	spec := `{"openapi":"3.0.3","paths":{"/x":{"get":{"operationId":"shouldNotAppear","responses":{"200":{"description":"ok"}}}}}}`
	mem := &regMem{
		servers: []regServerRow{{
			id: "srv-empty", tenant: "tenant-a", name: "empty", display: "Empty",
			transport: "streamable-http", backendType: BackendOpenAPI, status: "active",
			backend:     mustJSON(t, map[string]any{"base_url": "https://table.example", "openapi_json": spec}),
			scopes:      []byte(`[]`),
			rate:        []byte(`{}`),
			publishedID: "ver-empty",
		}},
		versions: []regVersionRow{{
			id: "ver-empty", serverID: "srv-empty", shelf: "published",
			tools:   []byte(`[]`),
			backend: mustJSON(t, map[string]any{"base_url": "https://published.example", "openapi_json": spec}),
		}},
	}
	registry, host, _ := openRegMem(t, database.MySQL, mem)
	rec, err := registry.GetByName(context.Background(), "tenant-a", "empty")
	if err != nil {
		t.Fatal(err)
	}
	if got := listedToolNames(t, host, rec); len(got) != 0 {
		t.Fatalf("tools/list = %v, want none", got)
	}
}

func TestRegistryMissingPublishedVersionErrors(t *testing.T) {
	mem := &regMem{
		servers: []regServerRow{{
			id: "srv-miss", tenant: "tenant-a", name: "pets", display: "Pets",
			transport: "streamable-http", backendType: BackendOpenAPI, status: "active",
			backend: []byte(`{}`), scopes: []byte(`[]`), rate: []byte(`{}`),
			publishedID: "ver-draft",
		}},
		tools: []regToolRow{{
			serverID: "srv-miss", name: "fromTable", input: []byte(`{}`), metadata: []byte(`{}`), enabled: true,
		}},
		versions: []regVersionRow{{
			id: "ver-draft", serverID: "srv-miss", shelf: "draft",
			tools: mustJSON(t, []map[string]any{testTool("draftOnly", true)}), backend: []byte(`{}`),
		}},
	}
	registry, _, mem := openRegMem(t, database.PostgreSQL, mem)
	_, err := registry.GetByName(context.Background(), "tenant-a", "pets")
	if err == nil || !strings.Contains(err.Error(), "mcp:published_version_missing") {
		t.Fatalf("err = %v", err)
	}
	if queriesContain(mem, "mcp_tools") {
		t.Fatal("missing published version fell back to mcp_tools")
	}
}

func TestRegistryListActiveSeparatesStockAndPublished(t *testing.T) {
	mem := &regMem{
		servers: []regServerRow{
			{
				id: "srv-stock", tenant: "tenant-a", name: "alpha", display: "Alpha",
				transport: "streamable-http", backendType: BackendOpenAPI, status: "active",
				backend: mustJSON(t, map[string]any{"base_url": "https://alpha.example"}),
				scopes:  []byte(`[]`), rate: []byte(`{}`),
			},
			{
				id: "srv-pub", tenant: "tenant-a", name: "beta", display: "Beta",
				transport: "streamable-http", backendType: BackendOpenAPI, status: "active",
				backend: mustJSON(t, map[string]any{"base_url": "https://beta-table.example"}),
				scopes:  []byte(`[]`), rate: []byte(`{}`),
				publishedID: "ver-beta",
			},
		},
		tools: []regToolRow{
			{serverID: "srv-stock", name: "legacy", input: []byte(`{}`), metadata: []byte(`{}`), enabled: true},
			{serverID: "srv-pub", name: "stale", input: []byte(`{}`), metadata: []byte(`{}`), enabled: true},
		},
		versions: []regVersionRow{{
			id: "ver-beta", serverID: "srv-pub", shelf: "published",
			tools:   mustJSON(t, []map[string]any{testTool("live", true)}),
			backend: mustJSON(t, map[string]any{"base_url": "https://beta-published.example"}),
		}},
	}
	registry, host, _ := openRegMem(t, database.MySQL, mem)
	list, err := registry.ListActive(context.Background(), "tenant-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("len = %d", len(list))
	}
	byName := map[string]*ServerRecord{}
	for _, rec := range list {
		byName[rec.Name] = rec
	}
	alpha := byName["alpha"]
	beta := byName["beta"]
	if alpha == nil || beta == nil {
		t.Fatalf("names missing: %+v", byName)
	}
	if alpha.ToolsFromPublishedVersion || alpha.BackendConfig["base_url"] != "https://alpha.example" {
		t.Fatalf("alpha = %+v", alpha)
	}
	if got := listedToolNames(t, host, alpha); len(got) != 1 || got[0] != "legacy" {
		t.Fatalf("alpha tools = %v", got)
	}
	if !beta.ToolsFromPublishedVersion || beta.BackendConfig["base_url"] != "https://beta-published.example" {
		t.Fatalf("beta backend = %#v pinned=%v", beta.BackendConfig, beta.ToolsFromPublishedVersion)
	}
	if got := listedToolNames(t, host, beta); len(got) != 1 || got[0] != "live" {
		t.Fatalf("beta tools = %v", got)
	}
}
