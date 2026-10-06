// Package connectors 内置连接器供给：go:embed 打包进二进制，
// 运行时可叠加外部目录（--connectors-dir）的额外定义。
package connectors

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/agenticx/connector-runtime/internal/model"
)

//go:embed definitions/*.json
var defsFS embed.FS

// Builtin 返回内置连接器（按 id 排序，输出稳定）。
func Builtin() ([]*model.Connector, error) {
	entries, err := defsFS.ReadDir("definitions")
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	out := make([]*model.Connector, 0, len(names))
	for _, name := range names {
		b, err := defsFS.ReadFile(filepath.Join("definitions", name))
		if err != nil {
			return nil, err
		}
		c, err := model.Parse(b)
		if err != nil {
			return nil, fmt.Errorf("内置连接器 %s: %w", name, err)
		}
		out = append(out, c)
	}
	return out, nil
}

// LoadDir 加载目录下全部 *.json 定义（目录为空返回空切片）。
func LoadDir(dir string) ([]*model.Connector, error) {
	if dir == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	out := make([]*model.Connector, 0, len(names))
	for _, name := range names {
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return nil, err
		}
		c, err := model.Parse(b)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", filepath.Join(dir, name), err)
		}
		out = append(out, c)
	}
	return out, nil
}

// All 内置 + 外部目录合并。
func All(extraDir string) ([]*model.Connector, error) {
	builtin, err := Builtin()
	if err != nil {
		return nil, err
	}
	extra, err := LoadDir(extraDir)
	if err != nil {
		return nil, err
	}
	return append(builtin, extra...), nil
}
