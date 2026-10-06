package policy

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/agenticx/connector-runtime/internal/model"
)

func TestEvaluate(t *testing.T) {
	cases := []struct {
		name     string
		policy   Policy
		actionID string
		wantOK   bool
		wantCode string
	}{
		{"空策略默认放行", Policy{}, "a.b", true, ""},
		{"精确 block", Policy{Block: []string{"a.delete"}}, "a.delete", false, "action_blocked"},
		{"未命中 block 放行", Policy{Block: []string{"a.delete"}}, "a.get", true, ""},
		{"前缀 glob block", Policy{Block: []string{"a.purge.*"}}, "a.purge.all", false, "action_blocked"},
		{"连接器级 glob block", Policy{Block: []string{"a.*"}}, "a.anything", false, "action_blocked"},
		{"全通配 block", Policy{Block: []string{"*"}}, "x.y", false, "action_blocked"},
		{"block 优先于 allow", Policy{Allow: []string{"a.*"}, Block: []string{"a.delete"}}, "a.delete", false, "action_blocked"},
		{"allow 命中放行", Policy{Allow: []string{"a.*"}}, "a.get", true, ""},
		{"默认 deny 未命中 allow", Policy{Default: "deny", Allow: []string{"a.get"}}, "a.put", false, "action_blocked"},
		{"默认 deny 命中 allow 放行", Policy{Default: "deny", Allow: []string{"a.get"}}, "a.get", true, ""},
		{"Sanitize 处理空串与空白", Policy{Block: []string{" ", "a.x", ""}, Default: ""}, "a.x", false, "action_blocked"},
	}
	for i := range cases {
		tc := &cases[i]
		t.Run(tc.name, func(t *testing.T) {
			tc.policy.Sanitize()
			d := tc.policy.Evaluate(tc.actionID)
			if d.Allowed != tc.wantOK || d.Code != tc.wantCode {
				t.Fatalf("Evaluate(%s) = %+v，期望 allowed=%v code=%s", tc.actionID, d, tc.wantOK, tc.wantCode)
			}
		})
	}
}

func TestEvaluateConnection(t *testing.T) {
	act := model.Action{ID: "a.purge", RequiredScopes: []string{"read", "admin"}}
	cases := []struct {
		name    string
		scopes  []string
		wantOK  bool
	}{
		{"全部授予", []string{"read", "admin", "extra"}, true},
		{"顺序无关", []string{"admin", "read"}, true},
		{"缺一个", []string{"read"}, false},
		{"全缺", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := EvaluateConnection(act, tc.scopes)
			if d.Allowed != tc.wantOK {
				t.Fatalf("%+v", d)
			}
			if !d.Allowed && d.Code != "scope_denied" {
				t.Fatalf("拒绝码应为 scope_denied: %s", d.Code)
			}
		})
	}
	// 无 requiredScopes 的动作对任意连接放行
	if d := EvaluateConnection(model.Action{ID: "a.get"}, nil); !d.Allowed {
		t.Fatalf("无 scope 要求应放行: %+v", d)
	}
}

func TestLoadSave(t *testing.T) {
	dir := t.TempDir()
	// 不存在 → 默认放行
	p, err := Load(filepath.Join(dir, "policy.json"))
	if err != nil || !p.Evaluate("x.y").Allowed {
		t.Fatalf("默认策略应放行: %v %+v", err, p)
	}
	// 保存后重读：block a.*，allow b.*，默认 deny
	p2 := &Policy{Allow: []string{"b.*"}, Block: []string{"a.*"}, Default: "deny"}
	if err := p2.Save(dir); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(filepath.Join(dir, "policy.json"))
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("策略文件权限 %o", info.Mode().Perm())
	}
	p3, err := Load(filepath.Join(dir, "policy.json"))
	if err != nil {
		t.Fatal(err)
	}
	if p3.Evaluate("a.get").Allowed || !p3.Evaluate("b.get").Allowed || p3.Evaluate("c.get").Allowed {
		t.Fatalf("重读策略语义不符: %+v", p3)
	}
	// 损坏文件报错
	if err := os.WriteFile(filepath.Join(dir, "policy.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(filepath.Join(dir, "policy.json")); err == nil {
		t.Fatal("损坏文件应报错")
	}
}
