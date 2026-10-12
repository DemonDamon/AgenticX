package audit

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLogJSONLRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	l := New(&buf)
	if err := l.Log(Entry{ExecutionID: "exec-1", Action: "a.get", ConnectorID: "a",
		Status: StatusOK, DurationMS: 12}); err != nil {
		t.Fatal(err)
	}
	if err := l.Log(Entry{ExecutionID: "exec-2", Action: "a.del", ConnectorID: "a",
		ConnectionID: "conn-1", Status: StatusDenied, ErrorCode: "action_blocked"}); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("应有 2 行: %d", len(lines))
	}
	var e Entry
	if err := json.Unmarshal([]byte(lines[1]), &e); err != nil {
		t.Fatal(err)
	}
	if e.ExecutionID != "exec-2" || e.ErrorCode != "action_blocked" || e.Timestamp.IsZero() {
		t.Fatalf("字段不符: %+v", e)
	}
}

func TestOpenFileAppendAndRead(t *testing.T) {
	dir := t.TempDir()
	l1, f1, err := OpenFile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := l1.Log(Entry{ExecutionID: "e1", Action: "a.get", ConnectorID: "a", Status: StatusOK}); err != nil {
		t.Fatal(err)
	}
	f1.Close()

	l2, f2, err := OpenFile(dir) // 追加模式
	if err != nil {
		t.Fatal(err)
	}
	if err := l2.Log(Entry{ExecutionID: "e2", Action: "a.get", ConnectorID: "a", Status: StatusOK}); err != nil {
		t.Fatal(err)
	}
	f2.Close()

	entries, err := ReadAll(filepath.Join(dir, "audit.log"), 0)
	if err != nil || len(entries) != 2 {
		t.Fatalf("应读到 2 条: %v %+v", err, entries)
	}
	if entries[0].ExecutionID != "e1" || entries[1].ExecutionID != "e2" {
		t.Fatalf("追加顺序不符: %+v", entries)
	}
	// limit 只取尾部
	limited, _ := ReadAll(filepath.Join(dir, "audit.log"), 1)
	if len(limited) != 1 || limited[0].ExecutionID != "e2" {
		t.Fatalf("limit 语义不符: %+v", limited)
	}
	// 权限
	info, _ := os.Stat(filepath.Join(dir, "audit.log"))
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("审计文件权限 %o", info.Mode().Perm())
	}
}

func TestRedactValue(t *testing.T) {
	in := map[string]any{
		"apiKey":     "sk-plain-secret",
		"api_key":    "sk-plain-secret",
		"Authorization": "Bearer abcdef123456",
		"nested": map[string]any{
			"access_token": "t",
			"name":         "safe",
		},
		"list": []any{map[string]any{"secret": "s", "ok": "keep"}},
		"normal": "keep-me",
	}
	out := RedactValue(in).(map[string]any)
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "sk-plain-secret") || strings.Contains(string(raw), "abcdef123456") {
		t.Fatalf("脱敏不完全: %s", raw)
	}
	if out["normal"] != "keep-me" || out["nested"].(map[string]any)["name"] != "safe" {
		t.Fatalf("非敏感值被误伤: %s", raw)
	}
	if out["list"].([]any)[0].(map[string]any)["ok"] != "keep" {
		t.Fatalf("数组内非敏感值被误伤: %s", raw)
	}
}

func TestRedactString(t *testing.T) {
	cases := []struct{ in, bad string }{
		{"Bearer eyJhbGciOi.very.long.token", "eyJhbGciOi"},
		{"key is sk-abc123def456 ok", "abc123def456"},
		{"normal text without secrets", ""},
	}
	for _, tc := range cases {
		got := RedactString(tc.in)
		if tc.bad != "" && strings.Contains(got, tc.bad) {
			t.Fatalf("未脱敏: %s -> %s", tc.in, got)
		}
		if tc.bad == "" && got != tc.in {
			t.Fatalf("误伤: %s -> %s", tc.in, got)
		}
	}
}
