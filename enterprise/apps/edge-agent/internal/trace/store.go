package trace

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Store persists trace spans as JSONL (one span per line).
type Store struct {
	path string
	mu   sync.Mutex
}

func NewStore(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("trace store path required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := os.WriteFile(path, nil, 0o600); err != nil {
			return nil, err
		}
	}
	return &Store{path: path}, nil
}

func (s *Store) AppendSpan(span Span) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.OpenFile(s.path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	data, err := json.Marshal(span)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(data, '\n')); err != nil {
		return err
	}
	return nil
}

func (s *Store) ListTraceIDs(limit int) ([]string, error) {
	spans, err := s.loadAll()
	if err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	var ids []string
	for _, span := range spans {
		if _, ok := seen[span.TraceID]; ok {
			continue
		}
		seen[span.TraceID] = struct{}{}
		ids = append(ids, span.TraceID)
	}
	sort.Strings(ids)
	if limit > 0 && len(ids) > limit {
		ids = ids[len(ids)-limit:]
	}
	return ids, nil
}

func (s *Store) GetTrace(traceID string) (Trace, bool, error) {
	spans, err := s.loadAll()
	if err != nil {
		return Trace{}, false, err
	}
	var matched []Span
	for _, span := range spans {
		if span.TraceID == traceID {
			matched = append(matched, span)
		}
	}
	if len(matched) == 0 {
		return Trace{}, false, nil
	}
	sort.Slice(matched, func(i, j int) bool { return matched[i].StepNo < matched[j].StepNo })
	return AggregateTrace(traceID, matched), true, nil
}

func (s *Store) loadAll() ([]Span, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.Open(s.path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var spans []Span
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var span Span
		if err := json.Unmarshal([]byte(line), &span); err != nil {
			return nil, err
		}
		spans = append(spans, span)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return spans, nil
}
