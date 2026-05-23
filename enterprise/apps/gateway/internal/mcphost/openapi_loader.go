package mcphost

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// OpenAPIOperation is a single HTTP operation extracted from OpenAPI 3.x.
type OpenAPIOperation struct {
	OperationID string
	Method      string
	Path        string
	Summary     string
	Description string
	Parameters  []OpenAPIParameter
	InputSchema json.RawMessage
	Disabled    bool
}

type OpenAPIParameter struct {
	Name     string
	In       string
	Required bool
	Schema   map[string]any
}

// OpenAPISpec is a minimal OpenAPI 3.x view used for MCP tool generation.
type OpenAPISpec struct {
	BaseURL    string
	Operations []OpenAPIOperation
	byID       map[string]OpenAPIOperation
}

func decodeOpenAPIBlob(blob string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(blob))
	if err != nil {
		return nil, fmt.Errorf("decode openapi_blob: %w", err)
	}
	gr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("gzip openapi_blob: %w", err)
	}
	defer gr.Close()
	out, err := io.ReadAll(io.LimitReader(gr, 8<<20))
	if err != nil {
		return nil, err
	}
	return out, nil
}

func EncodeOpenAPIBlob(raw []byte) (string, error) {
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	if _, err := gw.Write(raw); err != nil {
		return "", err
	}
	if err := gw.Close(); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

func ParseOpenAPISpec(raw []byte) (*OpenAPISpec, error) {
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("parse openapi json: %w", err)
	}
	spec := &OpenAPISpec{byID: map[string]OpenAPIOperation{}}
	if servers, ok := doc["servers"].([]any); ok && len(servers) > 0 {
		if s0, ok := servers[0].(map[string]any); ok {
			spec.BaseURL = strings.TrimSpace(fmt.Sprint(s0["url"]))
		}
	}
	paths, _ := doc["paths"].(map[string]any)
	for path, methodsAny := range paths {
		methods, _ := methodsAny.(map[string]any)
		for method, opAny := range methods {
			if strings.HasPrefix(method, "x-") {
				continue
			}
			opMap, ok := opAny.(map[string]any)
			if !ok {
				continue
			}
			if disabled, _ := opMap["x-mcp-disabled"].(bool); disabled {
				continue
			}
			opID := strings.TrimSpace(fmt.Sprint(opMap["operationId"]))
			if opID == "" {
				opID = fmt.Sprintf("%s_%s", strings.ToLower(method), sanitizePath(path))
			}
			summary := strings.TrimSpace(fmt.Sprint(opMap["summary"]))
			desc := strings.TrimSpace(fmt.Sprint(opMap["description"]))
			description := summary
			if desc != "" {
				if description != "" {
					description += " — " + desc
				} else {
					description = desc
				}
			}
			params := extractParameters(opMap, doc)
			inputSchema := buildInputSchema(params, opMap)
			op := OpenAPIOperation{
				OperationID: opID,
				Method:      strings.ToUpper(method),
				Path:        path,
				Summary:     summary,
				Description: description,
				Parameters:  params,
				InputSchema: inputSchema,
			}
			spec.Operations = append(spec.Operations, op)
			spec.byID[opID] = op
		}
	}
	return spec, nil
}

func (s *OpenAPISpec) Tools(allowed map[string]struct{}) []Tool {
	out := make([]Tool, 0, len(s.Operations))
	for _, op := range s.Operations {
		if len(allowed) > 0 {
			if _, ok := allowed[op.OperationID]; !ok {
				continue
			}
		}
		desc := op.Description
		if desc == "" {
			desc = op.Summary
		}
		if desc == "" {
			desc = op.Method + " " + op.Path
		}
		out = append(out, Tool{
			Name:        op.OperationID,
			Description: desc,
			InputSchema: op.InputSchema,
			Enabled:     true,
		})
	}
	return out
}

func (s *OpenAPISpec) OperationByID(id string) (OpenAPIOperation, bool) {
	op, ok := s.byID[id]
	return op, ok
}

func sanitizePath(path string) string {
	path = strings.Trim(path, "/")
	path = strings.ReplaceAll(path, "/", "_")
	path = strings.ReplaceAll(path, "{", "")
	path = strings.ReplaceAll(path, "}", "")
	return path
}

func extractParameters(op map[string]any, doc map[string]any) []OpenAPIParameter {
	var out []OpenAPIParameter
	if params, ok := op["parameters"].([]any); ok {
		for _, pAny := range params {
			pMap, ok := pAny.(map[string]any)
			if !ok {
				continue
			}
			out = append(out, mapParameter(pMap))
		}
	}
	if rb, ok := op["requestBody"].(map[string]any); ok {
		schema := requestBodySchema(rb)
		if schema != nil {
			out = append(out, OpenAPIParameter{
				Name:     "body",
				In:       "body",
				Required: true,
				Schema:   schema,
			})
		}
	}
	_ = doc
	return out
}

func mapParameter(p map[string]any) OpenAPIParameter {
	name := strings.TrimSpace(fmt.Sprint(p["name"]))
	in := strings.TrimSpace(fmt.Sprint(p["in"]))
	required, _ := p["required"].(bool)
	schema, _ := p["schema"].(map[string]any)
	if schema == nil {
		schema = map[string]any{"type": "string"}
	}
	return OpenAPIParameter{Name: name, In: in, Required: required, Schema: schema}
}

func requestBodySchema(rb map[string]any) map[string]any {
	content, _ := rb["content"].(map[string]any)
	if content == nil {
		return nil
	}
	for _, ct := range []string{"application/json", "application/*+json", "*/*"} {
		if entry, ok := content[ct].(map[string]any); ok {
			if schema, ok := entry["schema"].(map[string]any); ok {
				return schema
			}
		}
	}
	return nil
}

func buildInputSchema(params []OpenAPIParameter, op map[string]any) json.RawMessage {
	props := map[string]any{}
	required := []string{}
	for _, p := range params {
		if p.In == "body" {
			if p.Schema != nil {
				if t, ok := p.Schema["type"].(string); ok && (t == "object" || t == "") {
					for k, v := range p.Schema {
						if k == "type" {
							continue
						}
						props[k] = v
					}
					if req, ok := p.Schema["required"].([]any); ok {
						for _, r := range req {
							required = append(required, fmt.Sprint(r))
						}
					}
				} else {
					props["body"] = p.Schema
					if p.Required {
						required = append(required, "body")
					}
				}
			}
			continue
		}
		schema := p.Schema
		if schema == nil {
			schema = map[string]any{"type": "string"}
		}
		props[p.Name] = schema
		if p.Required {
			required = append(required, p.Name)
		}
	}
	schema := map[string]any{
		"type":       "object",
		"properties": props,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	raw, _ := json.Marshal(schema)
	return raw
}

// MergeOneOfAnyOf degrades complex union schemas to object + description note.
func MergeOneOfAnyOf(schema map[string]any) map[string]any {
	if schema == nil {
		return map[string]any{"type": "object"}
	}
	if _, ok := schema["oneOf"]; ok {
		note, _ := schema["description"].(string)
		if note == "" {
			note = "oneOf union — provide fields matching one variant"
		}
		return map[string]any{
			"type":        "object",
			"description": note,
		}
	}
	if _, ok := schema["anyOf"]; ok {
		note, _ := schema["description"].(string)
		if note == "" {
			note = "anyOf union — provide matching fields"
		}
		return map[string]any{
			"type":        "object",
			"description": note,
		}
	}
	return schema
}
