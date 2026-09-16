package mcphost

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// 吊销链的端到端回归保护。
//
// 此前这一层只有各个小函数的单元测试：revoked() 的真值表、capability id 的大小写、
// 键的拼法。**整条链没有一个用例**——「管理员把一台 MCP 从能力包里移出去，那个人下次
// 调用就该被拒」这句话，没有任何测试在盯。中间任何一步查错表、少传一个参数、把
// 某个错误吞成放行，都不会有人发现，而症状是撤销静默失效：后台显示已经收回，实际还能用。
//
// 这里用一个进程内的假驱动跑真实的 Check()：真实 SQL 文本、真实 Rebind、真实的判定顺序。
// 不引第三方 mock 库——这条链的价值就在于「和线上跑的是同一段代码」，中间垫一层
// 别人的抽象反而把要验的东西挡掉了。

// stubResponder 按 SQL 里的特征子串决定这一次查询返回什么。
type stubResponder func(query string, args []driver.NamedValue) (rows [][]string, err error)

type stubDriver struct{}

type stubConn struct{ respond stubResponder }

type stubRows struct {
	data [][]string
	next int
}

var (
	registerStubOnce sync.Once
	stubRegistry     sync.Map // dsn -> stubResponder
)

func (stubDriver) Open(name string) (driver.Conn, error) {
	value, ok := stubRegistry.Load(name)
	if !ok {
		return nil, errors.New("unknown stub dsn: " + name)
	}
	return &stubConn{respond: value.(stubResponder)}, nil
}

func (c *stubConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (c *stubConn) Close() error                        { return nil }
func (c *stubConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }

func (c *stubConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	data, err := c.respond(query, args)
	if err != nil {
		return nil, err
	}
	return &stubRows{data: data}, nil
}

func (r *stubRows) Columns() []string {
	if len(r.data) == 0 {
		return []string{"c0"}
	}
	cols := make([]string, len(r.data[0]))
	for i := range cols {
		cols[i] = "c" + string(rune('0'+i))
	}
	return cols
}

func (r *stubRows) Close() error { return nil }

func (r *stubRows) Next(dest []driver.Value) error {
	if r.next >= len(r.data) {
		return io.EOF
	}
	for i, cell := range r.data[r.next] {
		if i < len(dest) {
			dest[i] = cell
		}
	}
	r.next++
	return nil
}

// newStubChecker 造一个跑在假驱动上的 EntitlementChecker。
func newStubChecker(t *testing.T, respond stubResponder) *EntitlementChecker {
	t.Helper()
	registerStubOnce.Do(func() { sql.Register("entitlement-stub", stubDriver{}) })
	dsn := t.Name()
	stubRegistry.Store(dsn, respond)
	t.Cleanup(func() { stubRegistry.Delete(dsn) })
	db, err := sql.Open("entitlement-stub", dsn)
	if err != nil {
		t.Fatalf("open stub database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewEntitlementChecker(&database.Handle{Dialect: database.MySQL, DB: db}, nil)
}

// 各步查询的识别特征。改了 SQL 又忘了改这里，用例会立刻失败而不是悄悄跑偏。
func step(query string) string {
	switch {
	case strings.Contains(query, "enterprise_capability_assignments"):
		return "assigned"
	case strings.Contains(query, "enterprise_capability_pack_members"):
		return "governed"
	case strings.Contains(query, optOutTable):
		return "optOut"
	case strings.Contains(query, "enterprise_user_group_members"):
		return "groups"
	case strings.Contains(query, "FROM departments"):
		return "departments"
	}
	return "unknown:" + query
}

const (
	stubTenant = "01J00000000000000000000001"
	stubServer = "01M0CF4QGCWN8V58KSWBXK2G98"
)

func stubIdentity() Identity {
	return Identity{
		TenantID:     stubTenant,
		UserID:       "01M0USER0000000000000000AA",
		UserEmail:    "Zhang@Example.com",
		DepartmentID: "d_fe",
	}
}

func stubRecord() *ServerRecord {
	return &ServerRecord{ID: stubServer, Name: "fetch"}
}

// found/empty 让每个用例只写它关心的那几步。
var (
	found = [][]string{{"1"}}
	empty = [][]string{}
)

func TestChainAllowsAServerAssignedThroughTheUsersDepartment(t *testing.T) {
	var seen []string
	checker := newStubChecker(t, func(query string, args []driver.NamedValue) ([][]string, error) {
		s := step(query)
		seen = append(seen, s)
		switch s {
		case "governed":
			return found, nil
		case "optOut":
			return empty, nil
		case "departments":
			// d_fe 的父是 d_root，d_root 到顶。
			if args[1].Value == "d_fe" {
				return [][]string{{"d_root"}}, nil
			}
			return [][]string{{""}}, nil
		case "groups":
			return [][]string{{"g_rd"}}, nil
		case "assigned":
			// 这一步是重点：真正发出去的 key 集合必须包含部门链和组。
			keys := map[string]bool{}
			for _, a := range args[2:] {
				keys[a.Value.(string)] = true
			}
			for _, want := range []string{"all", "email:zhang@example.com", "dept:d_fe", "dept:d_root", "group:g_rd"} {
				if !keys[want] {
					t.Errorf("assignment keys missing %q; got %v", want, keys)
				}
			}
			return found, nil
		}
		t.Fatalf("unexpected query step: %s", s)
		return nil, nil
	})

	decision, err := checker.Check(context.Background(), stubIdentity(), stubRecord())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if !decision.Governed || !decision.Allowed {
		t.Fatalf("decision = %+v, want governed+allowed", decision)
	}
	if revoked(decision) {
		t.Fatal("an assigned server must not be reported as revoked")
	}
}

func TestChainDeniesOnceTheServerLeavesEveryPackTheUserHas(t *testing.T) {
	// 「管理员把这台服务器从能力包里移出去」——链路必须在下一次调用就拒绝。
	checker := newStubChecker(t, func(query string, _ []driver.NamedValue) ([][]string, error) {
		switch step(query) {
		case "governed":
			return found, nil // 别的包还引用着它，所以仍归能力包管
		case "assigned":
			return empty, nil // 但这个人够得着的包里没有它了
		default:
			return empty, nil
		}
	})

	decision, err := checker.Check(context.Background(), stubIdentity(), stubRecord())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if !revoked(decision) {
		t.Fatalf("decision = %+v, want revoked", decision)
	}
}

func TestChainDeniesWhenTheUserSwitchedItOffThemselves(t *testing.T) {
	var reachedAssigned bool
	checker := newStubChecker(t, func(query string, _ []driver.NamedValue) ([][]string, error) {
		switch step(query) {
		case "governed":
			return found, nil
		case "optOut":
			return found, nil
		case "assigned":
			reachedAssigned = true
			return found, nil
		default:
			return empty, nil
		}
	})

	decision, err := checker.Check(context.Background(), stubIdentity(), stubRecord())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if !revoked(decision) {
		t.Fatalf("decision = %+v, want revoked", decision)
	}
	if reachedAssigned {
		t.Fatal("opt-out must short-circuit before the assignment lookup")
	}
}

func TestChainStaysUngovernedForAServerNoPackReferences(t *testing.T) {
	// 没有任何包引用 = 管理员直接注册、PAT 直接调的老用法，必须保持原样放行。
	checker := newStubChecker(t, func(query string, _ []driver.NamedValue) ([][]string, error) {
		if step(query) == "governed" {
			return empty, nil
		}
		t.Fatalf("no query should follow an ungoverned verdict, got %s", step(query))
		return nil, nil
	})

	decision, err := checker.Check(context.Background(), stubIdentity(), stubRecord())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if decision.Governed || revoked(decision) {
		t.Fatalf("decision = %+v, want ungoverned", decision)
	}
}

// 每一步查询失败都必须判拒绝。放行等于「把库弄挂即可绕过撤销」。
func TestChainFailsClosedOnEveryLookupFailure(t *testing.T) {
	boom := errors.New("connection reset by peer")
	for _, failing := range []string{"optOut", "groups", "departments", "assigned"} {
		t.Run(failing, func(t *testing.T) {
			checker := newStubChecker(t, func(query string, _ []driver.NamedValue) ([][]string, error) {
				s := step(query)
				if s == failing {
					return nil, boom
				}
				if s == "governed" {
					return found, nil
				}
				if s == "departments" {
					return [][]string{{""}}, nil
				}
				return empty, nil
			})

			decision, err := checker.Check(context.Background(), stubIdentity(), stubRecord())
			if err == nil {
				t.Fatalf("%s failure should surface an error, got decision %+v", failing, decision)
			}
			if !revoked(decision) {
				t.Fatalf("%s failure produced %+v; a lookup we could not complete must deny", failing, decision)
			}
		})
	}
}

func TestChainDeniesAGovernedServerForAnAnonymousCaller(t *testing.T) {
	// 归能力包管的服务器必须归属到具体的人，否则无从判断范围。
	checker := newStubChecker(t, func(query string, _ []driver.NamedValue) ([][]string, error) {
		if step(query) == "governed" {
			return found, nil
		}
		t.Fatalf("no lookup should happen without a user, got %s", step(query))
		return nil, nil
	})

	identity := stubIdentity()
	identity.UserID = ""
	decision, err := checker.Check(context.Background(), identity, stubRecord())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if !revoked(decision) {
		t.Fatalf("decision = %+v, want revoked", decision)
	}
}
