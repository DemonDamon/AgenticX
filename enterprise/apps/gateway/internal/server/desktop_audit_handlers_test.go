package server

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	gatewayauth "github.com/agenticx/enterprise/gateway/internal/auth"
	"github.com/agenticx/enterprise/gateway/internal/database"
)

type fakeAuditWriter struct {
	mu     sync.Mutex
	events []audit.Event
}

func (f *fakeAuditWriter) Write(event *audit.Event) error {
	if event == nil {
		return errors.New("nil event")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, *event)
	return nil
}

type patStubDriver struct{}

type patStubConn struct{}

type patStubRows struct {
	values []driver.Value
	done   bool
}

func (patStubDriver) Open(string) (driver.Conn, error) { return patStubConn{}, nil }

func (patStubConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (patStubConn) Close() error                        { return nil }
func (patStubConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }

func (patStubConn) QueryContext(_ context.Context, _ string, args []driver.NamedValue) (driver.Rows, error) {
	tokenHash := ""
	if len(args) > 0 {
		tokenHash, _ = args[0].Value.(string)
	}
	scopes := `["workspace:chat"]`
	if tokenHash == hashPlainPAT("agx-pat-managed") {
		scopes = `["workspace:chat","desktop:managed"]`
	}
	return &patStubRows{values: []driver.Value{
		int64(7),
		"tenant-1",
		"user-1",
		"dept-1",
		"active",
		[]byte(scopes),
		nil,
	}}, nil
}

func (r *patStubRows) Columns() []string {
	return []string{"id", "tenant_id", "user_id", "dept_id", "status", "scopes", "expire_at"}
}

func (r *patStubRows) Close() error { return nil }

func (r *patStubRows) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	for i := range dest {
		if i < len(r.values) {
			dest[i] = r.values[i]
		}
	}
	return nil
}

var registerPATStubOnce sync.Once

func hashPlainPAT(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

func newPATServer(t *testing.T, writer audit.EventWriter) *Server {
	t.Helper()
	registerPATStubOnce.Do(func() {
		sql.Register("desktop-audit-pat", patStubDriver{})
	})
	db, err := sql.Open("desktop-audit-pat", "mem")
	if err != nil {
		t.Fatalf("open stub database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return &Server{
		audit:       writer,
		patVerifier: gatewayauth.NewPATVerifier(&database.Handle{Dialect: database.MySQL, DB: db}),
	}
}

func postAudit(s *Server, token string, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/desktop/action-audit", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.handleDesktopActionAudit(rec, req)
	return rec
}

func TestDesktopActionAuditRejectsNonPAT(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pub, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("AUTH_JWT_PUBLIC_KEY", string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub})))
	claims := accessClaims{
		UserID:   "user-jwt",
		TenantID: "tenant-jwt",
		Email:    "a@example.invalid",
		Type:     "access",
		Scopes:   []string{"desktop:managed"},
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenticx-enterprise-web-portal",
			Audience:  jwt.ClaimStrings{"agenticx-web-users"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	writer := &fakeAuditWriter{}
	rec := postAudit(&Server{audit: writer}, signed, `{"events":[{"event_id":"`+strings.Repeat("a", 32)+`"}]}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if len(writer.events) != 0 {
		t.Fatalf("non-PAT request wrote %d events", len(writer.events))
	}
}

func TestDesktopActionAuditRejectsMissingScope(t *testing.T) {
	writer := &fakeAuditWriter{}
	s := newPATServer(t, writer)
	rec := postAudit(s, "agx-pat-chat-only", `{"events":[{"event_id":"`+strings.Repeat("b", 32)+`"}]}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if len(writer.events) != 0 {
		t.Fatalf("missing scope wrote %d events", len(writer.events))
	}
}

func TestDesktopActionAuditRejects201Events(t *testing.T) {
	writer := &fakeAuditWriter{}
	s := newPATServer(t, writer)
	events := make([]map[string]string, 201)
	for i := range events {
		events[i] = map[string]string{"event_id": strings.Repeat("c", 32)}
	}
	raw, err := json.Marshal(map[string]any{"events": events})
	if err != nil {
		t.Fatal(err)
	}
	rec := postAudit(s, "agx-pat-managed", string(raw))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if len(writer.events) != 0 {
		t.Fatalf("oversized batch wrote %d events", len(writer.events))
	}
}

func TestDesktopActionAuditWritesTwoEvents(t *testing.T) {
	writer := &fakeAuditWriter{}
	s := newPATServer(t, writer)
	ts := time.Now().UTC().Format(time.RFC3339)
	confirmID := strings.Repeat("a", 32)
	deniedID := strings.Repeat("b", 32)
	body := map[string]any{
		"events": []map[string]string{
			{
				"event_id":        confirmID,
				"ts":              ts,
				"kind":            "confirm_resolved",
				"session_id":      "sess-1",
				"agent_id":        "meta",
				"tool_name":       "bash_exec",
				"subject":         "git:push",
				"outcome":         "approved",
				"decision_source": "human",
				"risk":            "high",
				"args_digest":     strings.Repeat("ab", 32),
				"summary":         "push?",
			},
			{
				"event_id":        deniedID,
				"ts":              ts,
				"kind":            "policy_denied",
				"session_id":      "sess-1",
				"agent_id":        "meta",
				"tool_name":       "bash_exec",
				"subject":         "git:push",
				"outcome":         "denied",
				"decision_source": "enterprise_policy",
				"risk":            "",
				"args_digest":     strings.Repeat("cd", 32),
				"summary":         "git:push",
			},
		},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	rec := postAudit(s, "agx-pat-managed", string(raw))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Accepted int `json:"accepted"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Accepted != 2 || len(writer.events) != 2 {
		t.Fatalf("accepted=%d stored=%d", got.Accepted, len(writer.events))
	}
	for i, ev := range writer.events {
		if ev.EventType != "desktop_agent_action" {
			t.Fatalf("event %d type = %s", i, ev.EventType)
		}
		if ev.ClientType != "near-desktop" {
			t.Fatalf("event %d client = %s", i, ev.ClientType)
		}
		if !strings.HasPrefix(ev.ID, "dsk_") || len(ev.ID) != 26 {
			t.Fatalf("event %d id = %q", i, ev.ID)
		}
	}
	if writer.events[0].MCPStatus != "confirm_resolved:approved" {
		t.Fatalf("confirm status = %s", writer.events[0].MCPStatus)
	}
	if writer.events[0].ID != "dsk_"+confirmID[:22] {
		t.Fatalf("confirm id = %s", writer.events[0].ID)
	}
	denied := writer.events[1]
	if denied.MCPStatus != "policy_denied:denied" {
		t.Fatalf("denied status = %s", denied.MCPStatus)
	}
	if len(denied.PoliciesHit) == 0 || denied.PoliciesHit[0].Action != "block" {
		t.Fatalf("policies = %+v", denied.PoliciesHit)
	}
	if denied.PoliciesHit[0].PolicyID != "desktop-agent-policy" || denied.PoliciesHit[0].MatchedRule != "git:push" {
		t.Fatalf("policy hit = %+v", denied.PoliciesHit[0])
	}
}
