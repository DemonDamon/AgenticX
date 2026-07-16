package audit

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// BackfillDaysFromEnv returns GATEWAY_AUDIT_BACKFILL_DAYS or 7.
func BackfillDaysFromEnv() int {
	raw := strings.TrimSpace(os.Getenv("GATEWAY_AUDIT_BACKFILL_DAYS"))
	if raw == "" {
		return 7
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 7
	}
	if n > 90 {
		return 90
	}
	return n
}

// RunBackfill scans recent audit JSONL files and inserts missing rows.
func RunBackfill(ctx context.Context, handle *database.Handle, dir string, days int, logger *slog.Logger) error {
	if logger == nil {
		logger = slog.Default()
	}
	if handle == nil {
		return fmt.Errorf("backfill: nil database handle")
	}
	files, err := listAuditJSONLInWindow(dir, days)
	if err != nil {
		return err
	}
	pg := NewPgWriter(handle)
	var inserted int
	for _, path := range files {
		nIns, rerr := backfillFile(ctx, pg, path, logger)
		if rerr != nil {
			return rerr
		}
		inserted += nIns
	}
	logger.Info("audit backfill done", "files", len(files), "lines", inserted)
	if err := clearPgPending(dir); err != nil {
		logger.Warn("clear pg pending failed", "error", err)
	}
	return nil
}

func listAuditJSONLInWindow(dir string, days int) ([]string, error) {
	if days < 1 {
		days = 7
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -days).Format("20060102")
	entries, err := os.ReadDir(dir)
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
		if !strings.HasPrefix(name, "audit-") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		dateStr := strings.TrimSuffix(strings.TrimPrefix(name, "audit-"), ".jsonl")
		if len(dateStr) != 8 || dateStr < cutoff {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]string, 0, len(names))
	for _, n := range names {
		out = append(out, filepath.Join(dir, n))
	}
	return out, nil
}

func backfillFile(ctx context.Context, pg *PgWriter, path string, logger *slog.Logger) (inserted int, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	// Avoid OOM on huge lines
	const maxLine = 16 << 20
	buf := make([]byte, maxLine)
	scanner.Buffer(buf, maxLine)
	lineNum := 0
	for scanner.Scan() {
		lineNum++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var ev Event
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			logger.Warn("backfill skip invalid json", "file", path, "line", lineNum)
			continue
		}
		if strings.TrimSpace(ev.ID) == "" || strings.TrimSpace(ev.TenantID) == "" {
			continue
		}
		inCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		err := pg.Insert(inCtx, ev)
		cancel()
		if err != nil {
			// ON CONFLICT DO NOTHING still returns nil; real errors are connectivity etc.
			logger.Warn("backfill insert failed", "file", path, "line", lineNum, "id", ev.ID, "error", err)
			return inserted, err
		}
		inserted++
	}
	return inserted, scanner.Err()
}
