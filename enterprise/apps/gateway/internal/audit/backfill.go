package audit

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
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

// PrepareDatabaseURL mirrors metering local-dev sslmode handling for pgx.
func PrepareDatabaseURL(connectionString string) string {
	trimmed := strings.TrimSpace(connectionString)
	if trimmed == "" {
		return trimmed
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "postgres://") || strings.HasPrefix(lower, "postgresql://") {
		parsed, err := url.Parse(trimmed)
		if err != nil {
			return trimmed
		}
		query := parsed.Query()
		if query.Get("sslmode") != "" {
			return trimmed
		}
		query.Set("sslmode", "disable")
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	if strings.Contains(lower, "sslmode=") {
		return trimmed
	}
	if strings.HasSuffix(trimmed, " ") {
		return trimmed + "sslmode=disable"
	}
	return trimmed + " sslmode=disable"
}

// NewPgxPool opens a small pool for audit inserts / backfill.
func NewPgxPool(connString string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(PrepareDatabaseURL(connString))
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 4
	cfg.MinConns = 0
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// RunBackfill scans recent audit JSONL files and inserts missing rows into PG.
func RunBackfill(ctx context.Context, pool *pgxpool.Pool, dir string, days int, logger *slog.Logger) error {
	if logger == nil {
		logger = slog.Default()
	}
	if pool == nil {
		return fmt.Errorf("backfill: nil pool")
	}
	files, err := listAuditJSONLInWindow(dir, days)
	if err != nil {
		return err
	}
	pg := NewPgWriter(pool)
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