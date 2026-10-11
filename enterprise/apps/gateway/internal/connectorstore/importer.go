// importer.go OpenAPI → 连接器定义的导入管线：企业以 OpenAPI 文档接入
// 内部应用，生成可执行的连接器定义（动作目录）。解析自包含于本包，
// 不依赖 mcphost 的 OpenAPI loader（避免循环依赖）。
package connectorstore

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"

	connectorapi "github.com/agenticx/connector-runtime/api"
)

// ErrDestructiveNeedsConfirm 导入包含 DELETE（destructive）动作，
// 需人工确认后才纳入（确认后携带 ConfirmDestructive 重入）。
type ErrDestructiveNeedsConfirm struct {
	Actions []string
}

func (e *ErrDestructiveNeedsConfirm) Error() string {
	return fmt.Sprintf("导入包含 %d 个 destructive（DELETE）动作，需人工确认: %s",
		len(e.Actions), strings.Join(e.Actions, ", "))
}

// AsDestructiveNeedsConfirm 从错误中提取待确认的 destructive 动作列表。
func AsDestructiveNeedsConfirm(err error) ([]string, bool) {
	var e *ErrDestructiveNeedsConfirm
	if errors.As(err, &e) {
		return e.Actions, true
	}
	return nil, false
}

// ImportOptions 导入选项。
type ImportOptions struct {
	ConnectorID        string // 目标连接器 id（小写字母/数字/连字符）
	DisplayName        string // 可选，默认取 info.title
	BaseURL            string // 可选，覆盖 servers[0]（内网反代场景）
	ConfirmDestructive bool   // 确认纳入 DELETE 动作
}

// ImportResult 导入产物。
type ImportResult struct {
	Connector   *connectorapi.Connector
	Destructive []string // destructive 动作 id（已确认纳入时非空）
}

// ---- 最小 OpenAPI 3.x 文档模型（只解析导入所需字段）----

type openapiDoc struct {
	Info struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	} `json:"info"`
	Servers []struct {
		URL string `json:"url"`
	} `json:"servers"`
	Paths map[string]openapiPathItem `json:"paths"`
	Components struct {
		SecuritySchemes map[string]openapiSecurityScheme `json:"securitySchemes"`
		Schemas         map[string]json.RawMessage       `json:"schemas"`
	} `json:"components"`
}

type openapiPathItem struct {
	Parameters []openapiParameter `json:"parameters"`
	Get        *openapiOperation  `json:"get"`
	Post       *openapiOperation  `json:"post"`
	Put        *openapiOperation  `json:"put"`
	Patch      *openapiOperation  `json:"patch"`
	Delete     *openapiOperation  `json:"delete"`
	Head       *openapiOperation  `json:"head"`
}

type openapiOperation struct {
	OperationID string                `json:"operationId"`
	Summary     string                `json:"summary"`
	Description string                `json:"description"`
	Parameters  []openapiParameter    `json:"parameters"`
	RequestBody *openapiRequestBody   `json:"requestBody"`
}

type openapiParameter struct {
	Name     string          `json:"name"`
	In       string          `json:"in"` // path | query | header
	Required bool            `json:"required"`
	Schema   json.RawMessage `json:"schema"`
}

type openapiRequestBody struct {
	Required bool `json:"required"`
	Content  map[string]struct {
		Schema json.RawMessage `json:"schema"`
	} `json:"content"`
}

type openapiSecurityScheme struct {
	Type string `json:"type"` // apiKey | http | oauth2 | openIdConnect
	In   string `json:"in"`   // apiKey 位置: header | query
	Name string `json:"name"`
}

var slugPattern = regexp.MustCompile(`[^a-z0-9]+`)

// ImportOpenAPI 解析 OpenAPI 文档并生成连接器定义。
// 动作映射：GET/HEAD→read、POST/PUT/PATCH→write、DELETE→destructive（需确认）；
// securitySchemes 仅 apiKey → api_key 认证，其余 → none。
func ImportOpenAPI(data []byte, opts ImportOptions) (*ImportResult, error) {
	var doc openapiDoc
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("解析 OpenAPI 文档失败: %w", err)
	}

	id := strings.TrimSpace(opts.ConnectorID)
	if id == "" {
		return nil, fmt.Errorf("connectorId 不能为空")
	}
	if !regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$`).MatchString(id) {
		return nil, fmt.Errorf("connectorId %q 不合法（需小写字母/数字/连字符）", id)
	}

	baseURL := strings.TrimRight(strings.TrimSpace(opts.BaseURL), "/")
	if baseURL == "" {
		if len(doc.Servers) == 0 || strings.TrimSpace(doc.Servers[0].URL) == "" {
			return nil, fmt.Errorf("缺少 baseUrl（OpenAPI 未声明 servers，需显式指定）")
		}
		baseURL = strings.TrimRight(strings.TrimSpace(doc.Servers[0].URL), "/")
	}

	displayName := strings.TrimSpace(opts.DisplayName)
	if displayName == "" {
		displayName = strings.TrimSpace(doc.Info.Title)
	}
	if displayName == "" {
		return nil, fmt.Errorf("displayName 不能为空（OpenAPI info.title 缺失，需显式指定）")
	}

	auth := resolveAuth(doc)
	actions, destructive, err := buildActions(doc, id)
	if err != nil {
		return nil, err
	}
	if len(destructive) > 0 && !opts.ConfirmDestructive {
		return nil, &ErrDestructiveNeedsConfirm{Actions: destructive}
	}

	c := &connectorapi.Connector{
		ID:          id,
		DisplayName: displayName,
		Description: strings.TrimSpace(doc.Info.Description),
		BaseURL:     baseURL,
		Auth:        auth,
		Actions:     actions,
	}
	if err := c.Validate(); err != nil {
		return nil, fmt.Errorf("生成的连接器定义未通过校验: %w", err)
	}
	return &ImportResult{Connector: c, Destructive: destructive}, nil
}

// resolveAuth 认证映射：securitySchemes 中首个 apiKey 型方案 → api_key，其余 → none。
func resolveAuth(doc openapiDoc) connectorapi.AuthSpec {
	for _, scheme := range doc.Components.SecuritySchemes {
		if strings.EqualFold(scheme.Type, "apikey") &&
			(scheme.In == "header" || scheme.In == "query") &&
			strings.TrimSpace(scheme.Name) != "" {
			return connectorapi.AuthSpec{
				Type:   connectorapi.AuthAPIKey,
				APIKey: &connectorapi.APIKeyAuth{In: scheme.In, Name: scheme.Name},
			}
		}
	}
	return connectorapi.AuthSpec{Type: connectorapi.AuthNone}
}

// buildActions 遍历 paths 生成动作；返回动作列表与 destructive 动作 id 列表。
func buildActions(doc openapiDoc, connectorID string) ([]connectorapi.Action, []string, error) {
	var actions []connectorapi.Action
	var destructive []string
	seen := map[string]int{}

	// 排序保证输出稳定（同文档重复导入生成一致定义）
	paths := make([]string, 0, len(doc.Paths))
	for p := range doc.Paths {
		paths = append(paths, p)
	}
	sort.Strings(paths)

	for _, path := range paths {
		item := doc.Paths[path]
		for _, m := range []struct {
			verb string
			op   *openapiOperation
		}{
			{"GET", item.Get}, {"POST", item.Post}, {"PUT", item.Put},
			{"PATCH", item.Patch}, {"DELETE", item.Delete}, {"HEAD", item.Head},
		} {
			if m.op == nil {
				continue
			}
			slug := slugify(m.op.OperationID)
			if slug == "" {
				slug = slugify(m.verb + "-" + strings.Trim(path, "/"))
			}
			if slug == "" {
				return nil, nil, fmt.Errorf("路径 %s %s 无法生成合法动作名", m.verb, path)
			}
			// 同名去重（追加序号）
			if n, dup := seen[slug]; dup {
				seen[slug] = n + 1
				slug = fmt.Sprintf("%s-%d", slug, n+1)
			} else {
				seen[slug] = 1
			}

			actionID := connectorID + "." + slug
			opType := "write"
			switch m.verb {
			case "GET", "HEAD":
				opType = "read"
			case "DELETE":
				opType = "destructive"
				destructive = append(destructive, actionID)
			}

			params := mergeParameters(item.Parameters, m.op.Parameters)
			act := connectorapi.Action{
				ID:            actionID,
				Title:         firstNonEmpty(m.op.Summary, slug),
				Description:   strings.TrimSpace(m.op.Description),
				OperationType: opType,
				InputSchema:   buildInputSchema(doc, params, m.op.RequestBody),
				HTTP: connectorapi.HTTPAction{
					Method: m.verb,
					Path:   path,
				},
			}
			// query/header 参数以模板引用输入（执行时渲染）
			for _, p := range params {
				switch p.In {
				case "query":
					if act.HTTP.Query == nil {
						act.HTTP.Query = map[string]string{}
					}
					act.HTTP.Query[p.Name] = "{" + p.Name + "}"
				case "header":
					if act.HTTP.Headers == nil {
						act.HTTP.Headers = map[string]string{}
					}
					act.HTTP.Headers[p.Name] = "{" + p.Name + "}"
				}
			}
			actions = append(actions, act)
		}
	}
	if len(actions) == 0 {
		return nil, nil, fmt.Errorf("OpenAPI 文档不含可导入的路径操作")
	}
	return actions, destructive, nil
}

// mergeParameters 合并 path 级与 operation 级参数（op 级同 name+in 覆盖）。
func mergeParameters(pathLevel, opLevel []openapiParameter) []openapiParameter {
	out := append([]openapiParameter{}, pathLevel...)
	for _, p := range opLevel {
		replaced := false
		for i := range out {
			if out[i].Name == p.Name && out[i].In == p.In {
				out[i] = p
				replaced = true
				break
			}
		}
		if !replaced {
			out = append(out, p)
		}
	}
	return out
}

// buildInputSchema 合并参数（path/query/header）与 JSON 请求体为动作输入 schema。
func buildInputSchema(doc openapiDoc, params []openapiParameter, body *openapiRequestBody) map[string]any {
	props := map[string]any{}
	required := []any{}
	addRequired := func(name string) {
		for _, r := range required {
			if r == name {
				return
			}
		}
		required = append(required, name)
	}
	for _, p := range params {
		switch p.In {
		case "path", "query", "header":
			if sch := doc.resolveSchema(p.Schema, 0); sch != nil {
				props[p.Name] = sch
			} else {
				props[p.Name] = map[string]any{"type": "string"}
			}
			if p.Required {
				addRequired(p.Name)
			}
		}
	}
	if body != nil {
		if c, ok := body.Content["application/json"]; ok && len(c.Schema) > 0 {
			sch := doc.resolveSchema(c.Schema, 0)
			if sch != nil && sch["type"] == "object" {
				if bp, ok := sch["properties"].(map[string]any); ok {
					for k, v := range bp {
						props[k] = v
					}
				}
				if req, ok := sch["required"].([]any); ok {
					for _, r := range req {
						if s, ok := r.(string); ok {
							addRequired(s)
						}
					}
				}
			} else if sch != nil {
				// 非对象请求体：整体以 body 为名传入
				props["body"] = sch
				if body.Required {
					addRequired("body")
				}
			}
		}
	}
	if len(props) == 0 {
		return nil
	}
	schema := map[string]any{"type": "object", "properties": props}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

// resolveSchema 解析 schema 原文；$ref 仅支持 #/components/schemas/*（深度上限防循环）。
func (d *openapiDoc) resolveSchema(raw json.RawMessage, depth int) map[string]any {
	if depth > 5 || len(raw) == 0 {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return nil
	}
	if ref, _ := m["$ref"].(string); ref != "" {
		name := strings.TrimPrefix(ref, "#/components/schemas/")
		if name == ref {
			return nil // 不支持的外部引用
		}
		next, ok := d.Components.Schemas[name]
		if !ok {
			return nil
		}
		return d.resolveSchema(next, depth+1)
	}
	return m
}

// slugify 清洗为小写 [a-z0-9-] 动作名片段。
func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugPattern.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
