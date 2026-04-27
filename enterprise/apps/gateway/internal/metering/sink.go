package metering

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Sink 抽象统一上报口；实现可以是 PG（Reporter）或本地 jsonl（FileSink），
// 让 server 在缺 DATABASE_URL 时仍能把 usage 记录下来供后续审计/排障。
type Sink interface {
	ReportAsync(record UsageRecord)
}

// FileSink 把 UsageRecord 异步追加到 jsonl 文件，便于本地开发态快速观察 token 用量。
type FileSink struct {
	path   string
	logger *slog.Logger
	mu     sync.Mutex
}

func NewFileSink(path string, logger *slog.Logger) (*FileSink, error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	// touch
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, err
	}
	_ = f.Close()
	return &FileSink{path: path, logger: logger}, nil
}

func (s *FileSink) ReportAsync(record UsageRecord) {
	go func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		f, err := os.OpenFile(s.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			s.logger.Error("file sink open failed", "error", err, "path", s.path)
			return
		}
		defer f.Close()
		if record.TimeBucket.IsZero() {
			record.TimeBucket = time.Now().UTC()
		}
		bytes, err := json.Marshal(record)
		if err != nil {
			s.logger.Error("file sink encode failed", "error", err)
			return
		}
		if _, err := f.Write(append(bytes, '\n')); err != nil {
			s.logger.Error("file sink write failed", "error", err)
		}
	}()
}
