package mcphost

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"

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

func mcpCapabilityID(serverID string) string {
	return "mcp:" + strings.TrimSpace(serverID)
}

// Check resolves the caller's entitlement for one hosted MCP server.
//
// 出错时的方向是分两段定的：连「这台服务器归不归能力包管」都查不出来（多半是租户
// 还没迁移，表不存在），按不归管处理，不影响既有用法；一旦确认归能力包管，后面任何
// 一步查询失败都判拒绝——否则只要让数据库报错就能绕过撤销。
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
		e.logger.Warn("mcp entitlement lookup failed; treating server as ungoverned",
			"server", rec.Name, "error", err)
		return Decision{Governed: false}, nil
	}
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

func (e *EntitlementChecker) optedOut(ctx context.Context, tenantID, userID, capabilityID string) (bool, error) {
	row, err := e.database.QueryRowContext(ctx, `
SELECT 1
FROM enterprise_capability_opt_outs
WHERE tenant_id = ? AND user_id = ? AND capability_id = ?
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
