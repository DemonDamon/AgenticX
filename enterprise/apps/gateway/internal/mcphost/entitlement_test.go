package mcphost

import (
	"context"
	"errors"
	"testing"

	mysqlDriver "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestBaseAssignmentKeysMirrorsPortal(t *testing.T) {
	// 与 web-portal 的 collectUserAssignmentKeys 必须给出同一组 key，否则会出现
	// 「登录时拿得到、真去调却被拒」这种最难查的不一致。
	keys := baseAssignmentKeys(Identity{UserID: "u1", UserEmail: "  Ann@Example.COM "})
	want := []string{"all", "u1", "email:ann@example.com"}
	if len(keys) != len(want) {
		t.Fatalf("keys = %v, want %v", keys, want)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("keys[%d] = %q, want %q", i, keys[i], want[i])
		}
	}
}

func TestBaseAssignmentKeysSkipsMissingIdentityFields(t *testing.T) {
	keys := baseAssignmentKeys(Identity{})
	if len(keys) != 1 || keys[0] != allMembersAssignmentKey {
		t.Fatalf("keys = %v, want only the all-members key", keys)
	}
}

func TestMcpCapabilityIDUsesRowPrimaryKey(t *testing.T) {
	if got := mcpCapabilityID(" 01JQMZ8K3N4P5Q6R7S8T9VWXYZ "); got != "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXYZ" {
		t.Fatalf("mcpCapabilityID = %q", got)
	}
}

func TestMcpCapabilityIDNormalizesCaseLikeThePortal(t *testing.T) {
	// config 包的 normalizeRowId 把 ULID 抬成大写。这边不抬，PG 上就会因为
	// varchar 区分大小写而查不到 pack 引用，撤销往放行那一侧静默失效。
	if got := mcpCapabilityID("01jqmz8k3n4p5q6r7s8t9vwxyz"); got != "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXYZ" {
		t.Fatalf("mcpCapabilityID = %q, want the uppercase ULID", got)
	}
}

func TestRevokedOnlyAppliesToGovernedServers(t *testing.T) {
	// 不被任何能力包引用的服务器保持原有行为，否则现有 PAT 用法会当场全断。
	if revoked(Decision{Governed: false, Allowed: false}) {
		t.Fatal("ungoverned server must not be denied")
	}
	if !revoked(Decision{Governed: true, Allowed: false}) {
		t.Fatal("governed but unassigned server must be denied")
	}
	if revoked(Decision{Governed: true, Allowed: true}) {
		t.Fatal("governed and assigned server must be allowed")
	}
}

func TestCheckTreatsBuiltinAndMissingDatabaseAsUngoverned(t *testing.T) {
	checker := NewEntitlementChecker(nil, nil)
	identity := Identity{TenantID: "t1", UserID: "u1"}

	demo, ok := builtinServer("demo")
	if !ok {
		t.Fatal("demo server missing")
	}
	decision, err := checker.Check(context.Background(), identity, demo)
	if err != nil || decision.Governed {
		t.Fatalf("builtin decision = %+v, err = %v", decision, err)
	}

	decision, err = checker.Check(context.Background(), identity, &ServerRecord{ID: "x", Name: "x"})
	if err != nil || decision.Governed {
		t.Fatalf("no-database decision = %+v, err = %v", decision, err)
	}
}

func TestEffectiveScopesAllowsWhenEntitlementUnavailable(t *testing.T) {
	// 租户还没迁移能力包表时，MCP 不该整体不可用，scope 也不该被改写。
	host := NewHost(nil, nil, nil, nil, nil)
	rec := &ServerRecord{ID: "01JQMZ8K3N4P5Q6R7S8T9VWXYZ", Name: "market-data", Status: "active"}
	scopes, err := host.EffectiveScopes(
		context.Background(),
		Identity{TenantID: "t1", UserID: "u1", Scopes: []string{"mcp:*"}},
		rec,
	)
	if err != nil {
		t.Fatalf("EffectiveScopes = %v, want nil error", err)
	}
	if len(scopes) != 1 || scopes[0] != "mcp:*" {
		t.Fatalf("scopes = %v, want the caller's own scopes untouched", scopes)
	}
}

func TestGrantServerScopesCoversOnlyThatServer(t *testing.T) {
	// 桌面端 PAT 只有 workspace:chat / desktop:managed，包分配得能补上这台的
	// 调用权限，否则管理员分配完员工照样调不动。
	scopes := grantServerScopes([]string{"workspace:chat", "desktop:managed"}, "market-data")
	if !CanInvokeTool(scopes, "market-data", nil, nil) {
		t.Fatal("granted server must be invokable")
	}
	// 但不能顺手把别的服务器一起放开。
	if CanInvokeTool(scopes, "payroll", nil, nil) {
		t.Fatal("grant must not extend to another server")
	}
}

func TestGrantServerScopesDoesNotDuplicateExistingGrants(t *testing.T) {
	scopes := grantServerScopes([]string{"mcp:*"}, "market-data")
	if len(scopes) != 1 {
		t.Fatalf("scopes = %v, want the wildcard left alone", scopes)
	}
}

func TestUnmigratedOnlyExcusesAMissingSchema(t *testing.T) {
	// 撤销判定唯一允许放行的失败，是「表压根没建过」——那时不可能存在撤销记录。
	checker := NewEntitlementChecker(nil, nil)
	if !checker.unmigrated(&pgconn.PgError{Code: "42P01"}) {
		t.Fatal("missing table must be treated as an unmigrated tenant")
	}
	// 连不上/超时/权限不足都证明不了「没有撤销记录」，放行就等于把库弄挂即可绕过撤销。
	for _, err := range []error{
		errors.New("dial tcp: connection refused"),
		context.DeadlineExceeded,
		&pgconn.PgError{Code: "42501"},
		&mysqlDriver.MySQLError{Number: 1205},
	} {
		if checker.unmigrated(err) {
			t.Fatalf("transient failure %v must not excuse the check", err)
		}
	}
}

func TestUnmigratedStopsExcusingOnceTheTablesHaveBeenSeen(t *testing.T) {
	// 表先查得到、后来说不存在，那是有人删了表或连错了库——事故，不是没迁移。
	checker := NewEntitlementChecker(nil, nil)
	checker.schemaReady.Store(true)
	if checker.unmigrated(&mysqlDriver.MySQLError{Number: 1146}) {
		t.Fatal("a table that vanished after being read must deny, not fall back to ungoverned")
	}
}
