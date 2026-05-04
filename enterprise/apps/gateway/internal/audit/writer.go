package audit

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/blake2b"
)

type PolicyHit struct {
	PolicyID    string `json:"policy_id"`
	Severity    string `json:"severity"`
	Action      string `json:"action"`
	MatchedRule string `json:"matched_rule,omitempty"`
}

type Event struct {
	ID           string      `json:"id"`
	TenantID     string      `json:"tenant_id"`
	EventTime    string      `json:"event_time"`
	EventType    string      `json:"event_type"`
	UserID       string      `json:"user_id,omitempty"`
	UserEmail    string      `json:"user_email,omitempty"`
	DepartmentID string      `json:"department_id,omitempty"`
	SessionID    string      `json:"session_id,omitempty"`
	ClientType   string      `json:"client_type"`
	ClientIP     string      `json:"client_ip,omitempty"`
	Provider     string      `json:"provider,omitempty"`
	Model        string      `json:"model,omitempty"`
	Route        string      `json:"route"`
	InputTokens  int         `json:"input_tokens,omitempty"`
	OutputTokens int         `json:"output_tokens,omitempty"`
	TotalTokens  int         `json:"total_tokens,omitempty"`
	LatencyMS    int64       `json:"latency_ms,omitempty"`
	Digest       *Digest     `json:"digest,omitempty"`
	PoliciesHit  []PolicyHit `json:"policies_hit,omitempty"`
	PrevChecksum string      `json:"prev_checksum"`
	Checksum     string      `json:"checksum"`
}

type Digest struct {
	PromptHash      string `json:"prompt_hash"`
	ResponseHash    string `json:"response_hash"`
	PromptSummary   string `json:"prompt_summary,omitempty"`
	ResponseSummary string `json:"response_summary,omitempty"`
}

type FileWriter struct {
	dir          string
	currentDate  string
	lastChecksum string
	mu           sync.Mutex
}

func NewFileWriter(dir string) *FileWriter {
	return &FileWriter{dir: dir}
}

func (w *FileWriter) Write(event *Event) error {
	if event == nil {
		return os.ErrInvalid
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	if err := os.MkdirAll(w.dir, 0o700); err != nil {
		return err
	}
	date := time.Now().UTC().Format("20060102")
	if w.currentDate != date {
		w.currentDate = date
	}
	filePath := filepath.Join(w.dir, "audit-"+date+".jsonl")
	if w.lastChecksum == "" {
		w.lastChecksum = readGlobalLastChecksum(w.dir)
	}

	event.PrevChecksum = nonEmpty(w.lastChecksum, "GENESIS")
	event.Checksum = ""
	rawForChecksum, err := json.Marshal(event)
	if err != nil {
		return err
	}
	sum := blake2b.Sum512([]byte(event.PrevChecksum + "|" + string(rawForChecksum)))
	event.Checksum = hex.EncodeToString(sum[:])[:64]
	finalRaw, err := json.Marshal(event)
	if err != nil {
		return err
	}

	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Write(append(finalRaw, '\n')); err != nil {
		return err
	}
	w.lastChecksum = event.Checksum
	return nil
}

func readLastChecksum(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()

	var line string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line = scanner.Text()
	}
	if strings.TrimSpace(line) == "" {
		return ""
	}
	var event Event
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		return ""
	}
	return event.Checksum
}

func readGlobalLastChecksum(dir string) string {
	files, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	lastFile := ""
	for _, file := range files {
		if file.IsDir() {
			continue
		}
		name := file.Name()
		if !strings.HasPrefix(name, "audit-") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		if name > lastFile {
			lastFile = name
		}
	}
	if lastFile == "" {
		return ""
	}
	return readLastChecksum(filepath.Join(dir, lastFile))
}

func nonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}
