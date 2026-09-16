package mcphost

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// ErrCapabilityRevoked means the caller is authenticated but no longer entitled
// to this MCP server through any capability pack.
var ErrCapabilityRevoked = errors.New("mcp:capability_revoked")

// allMembersAssignmentKey must match the portal and admin console. A third
// spelling of this key silently grants nobody.
const allMembersAssignmentKey = "all"

// maxDepartmentDepth bounds the parent walk so a cyclic row cannot hang a request.
const maxDepartmentDepth = 32

// optOutTable is asserted against db-schema in entitlement_schema_test.go.
const optOutTable = "enterprise_user_opt_outs"

// EntitlementChecker answers "may this caller still use this MCP server right now"
// against the capability pack tables.
//
// 桌面端把企业配置连同 token 明文缓存在本机，所以「后台停用了」这件事只有在网关
// 这一侧判定才算数：客户端那边的删除只挡得住正常使用的人。
//
// 这里不做缓存。缓存多久，撤销就晚多久生效，而及时撤销正是这个检查存在的全部理由；
// 这几张表都很小且带索引，MCP 工具调用也不是高频路径。
type EntitlementChecker struct {
	database *database.Handle
	logger   *slog.Logger
	// schemaReady 记住「这套能力包表确实存在」。一旦查成功过一次，之后再报表不存在
	// 就不是「还没迁移」而是有人把表删了或指错了库，那必须拒绝而不是放行。
	schemaReady atomic.Bool
	// 未迁移的租户每次调用都会命中同一个错误，只警告一次就够运维看见了。
	warnMissingSchema sync.Once
}

func NewEntitlementChecker(handle *database.Handle, logger *slog.Logger) *EntitlementChecker {
	if logger == nil {
		logger = slog.Default()
	}
	return &EntitlementChecker{database: handle, logger: logger}
}

// Decision is the outcome for one (caller, server) pair.
type Decision struct {
	// Governed reports whether any capability pack references this server.
	// 不被任何能力包引用的服务器保持原有行为：它们是管理员直接注册、由 PAT 直接
	// 调用的，本来就不经过能力包这套分配。
	Governed bool
	// Allowed is meaningful only when Governed is true.
	Allowed bool
}

// mcpCapabilityID 必须和 config 包的 formatCapabilityId 逐字节一致。
//
// ULID 的规范形态是大写 Crockford base32，TS 侧 normalizeRowId 会强制抬成大写；
// 这边只 trim 的话，遇到小写的 mcp_servers.id 就会拼出对不上的 capability id。
// PG 的 varchar 比较区分大小写，于是 governed 查成 false，这台服务器被当作「不归
// 能力包管」——撤销静默失效，而且是往放行那一侧失效。（MySQL 的 _ci collation
// 恰好不区分大小写，所以这个洞只在 PG 上现形，更难查。）
func mcpCapabilityID(serverID string) string {
	return "mcp:" + strings.ToUpper(strings.TrimSpace(serverID))
}

// Check resolves the caller's entitlement for one hosted MCP server.
//
// 出错时往哪边倒，只看一件事：这次失败能不能证明「不可能存在撤销记录」。
//
// 能证明的只有一种——能力包那几张表根本不存在，即这套功能还没迁移过。这时放行不会
// 放过任何本该被撤销的人，而拒绝会让所有既有 PAT 用法当场全断。
//
// 其余任何失败（连不上、超时、死锁、权限不足）都证明不了这一点：表可能好好地在那儿
// 装着撤销记录，只是这一刻查不到。放行就等于「把库弄挂即可绕过撤销」，所以一律判拒绝。
//
// 这里能这么严还有个前提：走到这一步之前，ResolveServer 已经用同一个 handle 成功读过
// mcp_servers。库真的挂了，请求在那一步就以 server_not_found 结束，根本到不了这里；
// 能到这里却查不动，本身就是异常，不是常态运维波动。
func (e *EntitlementChecker) Check(ctx context.Context, identity Identity, rec *ServerRecord) (Decision, error) {
	if e == nil || e.database == nil || rec == nil || rec.Builtin {
		return Decision{Governed: false}, nil
	}
	tenantID := strings.TrimSpace(identity.TenantID)
	capabilityID := mcpCapabilityID(rec.ID)
	if tenantID == "" || strings.TrimSpace(rec.ID) == "" {
		return Decision{Governed: false}, nil
	}

	governed, err := e.governed(ctx, tenantID, capabilityID)
	if err != nil {
		if e.unmigrated(err) {
			e.warnMissingSchema.Do(func() {
				e.logger.Warn("capability pack tables are missing; MCP entitlement checks are inactive until the migration runs",
					"server", rec.Name, "error", err)
			})
			return Decision{Governed: false}, nil
		}
		return Decision{Governed: true, Allowed: false}, fmt.Errorf("governed lookup: %w", err)
	}
	e.schemaReady.Store(true)
	if !governed {
		return Decision{Governed: false}, nil
	}

	userID := strings.TrimSpace(identity.UserID)
	if userID == "" {
		// 归能力包管的服务器必须能归属到具体的人，否则无从判断分配范围。
		return Decision{Governed: true, Allowed: false}, nil
	}

	optedOut, err := e.optedOut(ctx, tenantID, userID, capabilityID)
	if err != nil {
		return Decision{Governed: true, Allowed: false}, fmt.Errorf("opt-out lookup: %w", err)
	}
	if optedOut {
		return Decision{Governed: true, Allowed: false}, nil
	}

	keys, err := e.assignmentKeys(ctx, tenantID, identity)
	if err != nil {
		return Decision{Governed: true, Allowed: false}, fmt.Errorf("assignment keys: %w", err)
	}
	assigned, err := e.assigned(ctx, tenantID, capabilityID, keys)
	if err != nil {
		return Decision{Governed: true, Allowed: false}, fmt.Errorf("assignment lookup: %w", err)
	}
	return Decision{Governed: true, Allowed: assigned}, nil
}

func (e *EntitlementChecker) governed(ctx context.Context, tenantID, capabilityID string) (bool, error) {
	// 故意不看 pack 的状态：停用的包仍然让这台服务器归能力包管，只是当下谁都拿不到。
	row, err := e.database.QueryRowContext(ctx, `
SELECT 1
FROM enterprise_capability_pack_members m
JOIN enterprise_capability_packs p ON p.id = m.pack_id
WHERE p.tenant_id = ? AND m.capability_id = ?
LIMIT 1`, tenantID, capabilityID)
	if err != nil {
		return false, err
	}
	return scanExists(row)
}

// unmigrated reports whether this failure is the capability-pack schema simply
// not being there yet — the one failure that proves no revocation record can exist.
//
// schemaReady 一旦置位就再也不认这个理由：表先查得到、后来查不到，说明有人删了表或
// 连错了库，那是事故，不是「还没迁移」。
func (e *EntitlementChecker) unmigrated(err error) bool {
	return !e.schemaReady.Load() && database.IsMissingRelation(err)
}

// optedOut 查个人关闭记录。表名/列名必须跟着 db-schema 走：0056/0030 把
// enterprise_capability_opt_outs 并进了 enterprise_user_opt_outs，能力 id 存在
// subject 列里（模型则是 model:<provider>/<name>，同一张表）。
//
// 查错表在这里不是「少判一次 opt-out」——归能力包管之后任何一步查询失败都判拒绝，
// 于是所有被能力包管的 MCP 服务器会对所有人一起消失。
func (e *EntitlementChecker) optedOut(ctx context.Context, tenantID, userID, capabilityID string) (bool, error) {
	row, err := e.database.QueryRowContext(ctx, `
SELECT 1
FROM `+optOutTable+`
WHERE tenant_id = ? AND user_id = ? AND subject = ?
LIMIT 1`, tenantID, userID, capabilityID)
	if err != nil {
		return false, err
	}
	return scanExists(row)
}

func (e *EntitlementChecker) assigned(
	ctx context.Context,
	tenantID, capabilityID string,
	keys []string,
) (bool, error) {
	if len(keys) == 0 {
		return false, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")
	args := make([]any, 0, len(keys)+2)
	args = append(args, tenantID, capabilityID)
	for _, key := range keys {
		args = append(args, key)
	}
	row, err := e.database.QueryRowContext(ctx, `
SELECT 1
FROM enterprise_capability_pack_members m
JOIN enterprise_capability_packs p ON p.id = m.pack_id AND p.status = 'active'
JOIN enterprise_capability_assignments a ON a.pack_id = p.id AND a.tenant_id = p.tenant_id
WHERE p.tenant_id = ? AND m.capability_id = ? AND a.assignment_key IN (`+placeholders+`)
LIMIT 1`, args...)
	if err != nil {
		return false, err
	}
	return scanExists(row)
}

// assignmentKeys mirrors the portal's resolveAssignmentKeysForUser:
// 全员 + 本人 + 邮箱 + 直属部门一路到根 + 所属用户组。
//
// 两边必须给出同一组 key，否则会出现「登录时拿得到、真去调却被拒」这种最难查的
// 不一致。
func (e *EntitlementChecker) assignmentKeys(
	ctx context.Context,
	tenantID string,
	identity Identity,
) ([]string, error) {
	keys := baseAssignmentKeys(identity)
	if deptID := strings.TrimSpace(identity.DepartmentID); deptID != "" {
		ancestors, err := e.departmentChain(ctx, tenantID, deptID)
		if err != nil {
			return nil, err
		}
		for _, id := range ancestors {
			keys = append(keys, "dept:"+id)
		}
	}
	groups, err := e.groupIDs(ctx, tenantID, strings.TrimSpace(identity.UserID))
	if err != nil {
		return nil, err
	}
	for _, id := range groups {
		keys = append(keys, "group:"+id)
	}
	return keys, nil
}

// groupIDs lists the caller's user groups. 组是授予，属于多个组取并集。
func (e *EntitlementChecker) groupIDs(ctx context.Context, tenantID, userID string) ([]string, error) {
	if userID == "" {
		return nil, nil
	}
	rows, err := e.database.QueryContext(ctx, `
SELECT m.group_id
FROM enterprise_user_group_members m
JOIN enterprise_user_groups g ON g.id = m.group_id
WHERE g.tenant_id = ? AND m.user_id = ?`, tenantID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// baseAssignmentKeys is the part that needs no database: 全员 + 本人 + 邮箱。
// 部门链与用户组要查库，见 assignmentKeys。
func baseAssignmentKeys(identity Identity) []string {
	keys := []string{allMembersAssignmentKey}
	if userID := strings.TrimSpace(identity.UserID); userID != "" {
		keys = append(keys, userID)
	}
	if email := strings.ToLower(strings.TrimSpace(identity.UserEmail)); email != "" {
		keys = append(keys, "email:"+email)
	}
	return keys
}

// revoked turns a decision into the deny answer. 不归能力包管的服务器保持原样。
func revoked(d Decision) bool { return d.Governed && !d.Allowed }

// departmentChain walks parent_id upward, matching listDepartmentAncestorIds.
func (e *EntitlementChecker) departmentChain(ctx context.Context, tenantID, deptID string) ([]string, error) {
	out := make([]string, 0, 4)
	seen := map[string]bool{}
	current := deptID
	for i := 0; i < maxDepartmentDepth && current != "" && !seen[current]; i++ {
		seen[current] = true
		out = append(out, current)
		row, err := e.database.QueryRowContext(ctx, `
SELECT COALESCE(parent_id, '')
FROM departments
WHERE tenant_id = ? AND id = ?
LIMIT 1`, tenantID, current)
		if err != nil {
			return nil, err
		}
		var parent string
		if err := row.Scan(&parent); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				break
			}
			return nil, err
		}
		current = strings.TrimSpace(parent)
	}
	return out, nil
}

func scanExists(row *sql.Row) (bool, error) {
	var one int
	if err := row.Scan(&one); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
