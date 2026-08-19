package mcphost

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// 这套判定是 fail-closed 的：确认一台服务器归能力包管之后，任何一步查询出错都判
// 拒绝。所以一次 schema 漂移不会表现成「少判一次」，而是所有归能力包管的 MCP 服务
// 器对所有人一起消失。
//
// 0056/0030 把 enterprise_capability_opt_outs 并进 enterprise_user_opt_outs 时，
// 网关这边的 SQL 没跟着改，就正好撞上了这个放大器。Go 侧没有跑真库的测试，只能拿
// db-schema 的表声明当契约核对——比没有强得多，且几乎不要成本。

var (
	tableRefRe   = regexp.MustCompile(`(?im)^\s*(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)`)
	pgTableRe    = regexp.MustCompile(`pgTable\(\s*"([a-z_][a-z0-9_]*)"`)
	goConstRefRe = regexp.MustCompile(`(?im)^\s*(?:FROM|JOIN)\s+` + "`" + `\+([A-Za-z][A-Za-z0-9_]*)\+` + "`")
)

func schemaDir(t *testing.T) string {
	t.Helper()
	dir := filepath.Join("..", "..", "..", "..", "packages", "db-schema", "src", "schema")
	if _, err := os.Stat(dir); err != nil {
		t.Skipf("db-schema sources not available: %v", err)
	}
	return dir
}

func declaredTables(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	dir := schemaDir(t)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read schema dir: %v", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".ts") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		for _, m := range pgTableRe.FindAllStringSubmatch(string(raw), -1) {
			out[m[1]] = string(raw)
		}
	}
	if len(out) == 0 {
		t.Fatal("no pgTable declarations found; the contract check would pass vacuously")
	}
	return out
}

func TestEntitlementSQLOnlyTouchesTablesDbSchemaStillDeclares(t *testing.T) {
	raw, err := os.ReadFile("entitlement.go")
	if err != nil {
		t.Fatalf("read entitlement.go: %v", err)
	}
	source := string(raw)

	referenced := map[string]bool{}
	for _, m := range tableRefRe.FindAllStringSubmatch(source, -1) {
		referenced[m[1]] = true
	}
	// 拼进 SQL 的 Go 常量（optOutTable）也要算上，否则常量化就等于绕过这个检查。
	for _, m := range goConstRefRe.FindAllStringSubmatch(source, -1) {
		valueRe := regexp.MustCompile(m[1] + `\s*=\s*"([a-z_][a-z0-9_]*)"`)
		if v := valueRe.FindStringSubmatch(source); v != nil {
			referenced[v[1]] = true
		}
	}
	if !referenced[optOutTable] {
		t.Fatalf("opt-out table %q not picked up from the SQL; the check would miss a rename", optOutTable)
	}

	declared := declaredTables(t)
	var missing []string
	for table := range referenced {
		if _, ok := declared[table]; !ok {
			missing = append(missing, table)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Fatalf("entitlement SQL queries tables db-schema no longer declares: %v", missing)
	}
}

func TestOptOutLookupMatchesTheMergedSchema(t *testing.T) {
	declared := declaredTables(t)
	schema, ok := declared[optOutTable]
	if !ok {
		t.Fatalf("db-schema no longer declares %s", optOutTable)
	}
	if !strings.Contains(schema, `varchar("subject"`) {
		t.Fatalf("%s lost its subject column; the entitlement SQL filters on it", optOutTable)
	}

	// 只看 optedOut 这一段：enterprise_capability_pack_members 本来就有
	// capability_id 列，全文搜会把它一起判死。
	query := optedOutQuery(t)
	if strings.Contains(query, "capability_id") {
		t.Fatalf("opt-out lookup still filters on capability_id; the merged table uses subject:\n%s", query)
	}
	if !strings.Contains(query, "subject = ?") {
		t.Fatalf("opt-out lookup no longer filters on subject:\n%s", query)
	}
}

// optedOutQuery 抠出 optedOut 函数体，避免把同文件里别的 SQL 也算进来。
func optedOutQuery(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile("entitlement.go")
	if err != nil {
		t.Fatalf("read entitlement.go: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "func (e *EntitlementChecker) optedOut(")
	if start < 0 {
		t.Fatal("optedOut function not found")
	}
	end := strings.Index(source[start:], "\nfunc ")
	if end < 0 {
		return source[start:]
	}
	return source[start : start+end]
}
