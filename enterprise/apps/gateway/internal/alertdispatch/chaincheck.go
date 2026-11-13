package alertdispatch

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"golang.org/x/crypto/blake2b"
)

// StartChainCheck 周期校验审计 JSONL 防篡改链；发现断裂/篡改立即发 CRITICAL 告警。
//
// 与 admin-console 按需点检（/api/audit/chain-verify）互补：这里是网关侧
// 7×24 持续自检，覆盖"无人查看时段"的链完整性。
func StartChainCheck(stop <-chan struct{}, auditDir string, dispatcher *Dispatcher, logger *slog.Logger, interval time.Duration) {
	if dispatcher == nil || strings.TrimSpace(auditDir) == "" {
		return
	}
	if interval <= 0 {
		interval = 10 * time.Minute
	}
	if logger == nil {
		logger = slog.Default()
	}
	go func() {
		// 首检延迟一个周期，避免与启动期审计回填（backfill）竞态。
		timer := time.NewTimer(interval)
		defer timer.Stop()
		for {
			select {
			case <-stop:
				return
			case <-timer.C:
			}
			if err := VerifyAuditChain(auditDir); err != nil {
				logger.Error("audit chain verification failed", "dir", auditDir, "error", err)
				dispatcher.Dispatch(Alert{
					TenantID:  chainCheckTenant(auditDir),
					Source:    "chain_check",
					Severity:  "CRITICAL",
					Title:     "审计防篡改链校验失败",
					Summary:   "Audit chain verification failed: " + err.Error(),
					DedupKey:  "chain_check|" + auditDir,
					EventTime: time.Now().UTC(),
				})
			}
		}
	}()
}

// VerifyAuditChain 逐行重算 blake2b 校验和并验证跨行/跨文件链接。
// 任何一行校验失败、prev 链接断裂或解析失败都返回错误。
func VerifyAuditChain(auditDir string) error {
	files, err := listAuditFiles(auditDir)
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return nil
	}
	prev := "GENESIS"
	for _, name := range files {
		f, err := os.Open(filepath.Join(auditDir, name))
		if err != nil {
			return err
		}
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 0, 1024*1024), 16*1024*1024)
		lineNo := 0
		for scanner.Scan() {
			lineNo++
			line := scanner.Bytes()
			if len(strings.TrimSpace(string(line))) == 0 {
				continue
			}
			var event struct {
				PrevChecksum string `json:"prev_checksum"`
				Checksum     string `json:"checksum"`
			}
			if err := json.Unmarshal(line, &event); err != nil {
				_ = f.Close()
				return &ChainError{File: name, Line: lineNo, Reason: "json decode: " + err.Error()}
			}
			if event.PrevChecksum != prev {
				_ = f.Close()
				return &ChainError{File: name, Line: lineNo,
					Reason: "prev_checksum mismatch: expected " + prev + " got " + event.PrevChecksum}
			}
			expected := recomputeChecksum(line, event.Checksum)
			if expected == "" || expected != event.Checksum {
				_ = f.Close()
				return &ChainError{File: name, Line: lineNo, Reason: "checksum mismatch"}
			}
			prev = event.Checksum
		}
		scanErr := scanner.Err()
		_ = f.Close()
		if scanErr != nil {
			return &ChainError{File: name, Line: lineNo, Reason: scanErr.Error()}
		}
	}
	return nil
}

// recomputeChecksum 把行内 checksum 字段清零后重算 blake2b(prev|raw)。
// 通过把 "checksum":"<hex>" 文本替换为 "checksum":""（定长替换不破坏其余字段），
// 精确复现写入侧的 rawForChecksum。
func recomputeChecksum(line []byte, checksum string) string {
	marker := []byte(`"checksum":"` + checksum + `"`)
	replaced := bytesReplace(line, marker, []byte(`"checksum":""`))
	if replaced == nil {
		return ""
	}
	var event struct {
		PrevChecksum string `json:"prev_checksum"`
	}
	if err := json.Unmarshal(replaced, &event); err != nil {
		return ""
	}
	sum := blake2b.Sum512([]byte(event.PrevChecksum + "|" + string(replaced)))
	return hex.EncodeToString(sum[:])[:64]
}

func bytesReplace(data []byte, old, new []byte) []byte {
	idx := indexOf(data, old)
	if idx < 0 {
		return nil
	}
	out := make([]byte, 0, len(data)+len(new)-len(old))
	out = append(out, data[:idx]...)
	out = append(out, new...)
	out = append(out, data[idx+len(old):]...)
	return out
}

func indexOf(data, sub []byte) int {
	for i := 0; i+len(sub) <= len(data); i++ {
		match := true
		for j := range sub {
			if data[i+j] != sub[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

func listAuditFiles(auditDir string) ([]string, error) {
	entries, err := os.ReadDir(auditDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasPrefix(name, "audit-") && strings.HasSuffix(name, ".jsonl") {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names, nil
}

// ChainError 描述链上第一个断裂点。
type ChainError struct {
	File   string
	Line   int
	Reason string
}

func (e *ChainError) Error() string {
	return e.File + ":" + itoa(e.Line) + " " + e.Reason
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// chainCheckTenant 链自检是部署级事件；借用 default 租户配置分发，
// 未配置该租户时不分发（与现状等价）。
func chainCheckTenant(auditDir string) string {
	if v := strings.TrimSpace(os.Getenv("GATEWAY_ALERT_CHAIN_TENANT")); v != "" {
		return v
	}
	return "default"
}
