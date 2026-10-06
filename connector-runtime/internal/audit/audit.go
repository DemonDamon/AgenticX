// Package audit 执行审计：JSONL 追加写入，executionId 贯穿，
// 敏感值（凭据/token 类键名与 token 形态字符串）一律脱敏。
package audit

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

// 执行状态。
const (
	StatusOK     = "ok"
	StatusError  = "error"
	StatusDenied = "denied"
)

// Entry 单次执行（或拒绝）的审计记录。不含输入体与凭据。
type Entry struct {
	ExecutionID  string    `json:"executionId"`
	Timestamp    time.Time `json:"timestamp"`
	Action       string    `json:"action"`
	ConnectorID  string    `json:"connectorId"`
	ConnectionID string    `json:"connectionId,omitempty"`
	Status       string    `json:"status"`
	ErrorCode    string    `json:"errorCode,omitempty"`
	DurationMS   int64     `json:"durationMs"`
}

// Logger JSONL 审计日志器（并发安全）。
type Logger struct {
	mu sync.Mutex
	w  io.Writer
	bw *bufio.Writer
}

// New 构造日志器。
func New(w io.Writer) *Logger {
	return &Logger{w: w, bw: bufio.NewWriter(w)}
}

// OpenFile 打开（追加）审计文件，返回日志器与底层文件（调用方负责 Close 前 Flush）。
func OpenFile(dir string) (*Logger, *os.File, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, nil, err
	}
	f, err := os.OpenFile(filepath.Join(dir, "audit.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, nil, err
	}
	return New(f), f, nil
}

// Log 写一条记录；消息字段做脱敏兜底。
func (l *Logger) Log(e Entry) error {
	e.Timestamp = time.Now().UTC()
	if e.Status == "" {
		e.Status = StatusOK
	}
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, err := l.bw.Write(append(b, '\n')); err != nil {
		return err
	}
	return l.bw.Flush()
}

// ReadAll 读取审计文件（用于 /admin/audit）。
func ReadAll(path string, limit int) ([]Entry, error) {
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []Entry
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		var e Entry
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			return nil, fmt.Errorf("审计记录损坏: %w", err)
		}
		out = append(out, e)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if limit > 0 && len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out, nil
}

// ---- 脱敏 ----

var sensitiveKey = regexp.MustCompile(`(?i)^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|credential)$`)
var tokenLike = regexp.MustCompile(`(?i)(bearer\s+|sk-)[a-z0-9._~+/=-]{4,}`)

const masked = "***"

// RedactValue 递归脱敏 map/slice 中敏感键的值。
func RedactValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			if sensitiveKey.MatchString(k) {
				out[k] = masked
			} else {
				out[k] = RedactValue(val)
			}
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = RedactValue(val)
		}
		return out
	default:
		return v
	}
}

// RedactString 脱敏字符串中的 token 形态子串（如 "Bearer xxxx"、"sk-xxxx"）。
func RedactString(s string) string {
	return tokenLike.ReplaceAllString(s, "${1}"+masked)
}
