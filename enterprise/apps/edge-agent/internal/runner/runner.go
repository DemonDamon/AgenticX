package runner

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/agenticx/enterprise/edge-agent/internal/gateway"
	"github.com/agenticx/enterprise/edge-agent/internal/sandbox"
	"github.com/agenticx/enterprise/edge-agent/internal/trace"
)

type ModelCaller interface {
	Complete(ctx context.Context, traceID string, stepNo int, model, prompt string) (trace.Usage, error)
}

type Step struct {
	StepNo  int    `json:"step_no"`
	Kind    string `json:"kind"`
	Model   string `json:"model,omitempty"`
	Prompt  string `json:"prompt,omitempty"`
	Command []string `json:"command,omitempty"`
	RelPath string `json:"rel_path,omitempty"`
	Content string `json:"content,omitempty"`
}

type RunRequest struct {
	TraceID string `json:"trace_id,omitempty"`
	Steps   []Step `json:"steps"`
}

type RunResult struct {
	Trace trace.Trace `json:"trace"`
}

type Runner struct {
	gateway ModelCaller
	store   *trace.Store
	ingest  SpanIngester
	sandbox sandbox.Config
}

type SpanIngester interface {
	PushSpans(ctx context.Context, spans []trace.Span) error
}

func New(gw ModelCaller, store *trace.Store, sbCfg sandbox.Config) *Runner {
	return &Runner{gateway: gw, store: store, sandbox: sbCfg}
}

func (r *Runner) SetIngester(ingester SpanIngester) {
	r.ingest = ingester
}

func (r *Runner) Run(ctx context.Context, req RunRequest) (RunResult, error) {
	traceID := strings.TrimSpace(req.TraceID)
	if traceID == "" {
		traceID = newTraceID()
	}
	if len(req.Steps) == 0 {
		return RunResult{}, fmt.Errorf("steps required")
	}

	sb, err := sandbox.New(r.sandbox)
	if err != nil {
		return RunResult{}, err
	}
	defer sb.Close()

	var spans []trace.Span
	for _, step := range req.Steps {
		span := r.runStep(ctx, sb, traceID, step)
		spans = append(spans, span)
		if err := r.store.AppendSpan(span); err != nil {
			return RunResult{}, err
		}
	}
	result := RunResult{Trace: trace.AggregateTrace(traceID, spans)}
	if r.ingest != nil {
		_ = r.ingest.PushSpans(ctx, spans)
	}
	return result, nil
}

func (r *Runner) runStep(ctx context.Context, sb *sandbox.Sandbox, traceID string, step Step) trace.Span {
	started := time.Now().UTC()
	span := trace.Span{
		ID:         newSpanID(),
		TraceID:    traceID,
		StepNo:     step.StepNo,
		StepKind:   step.Kind,
		Status:     trace.StatusOK,
		StartedAt:  started,
		Metadata:   map[string]any{},
	}

	switch step.Kind {
	case trace.StepKindModel:
		usage, err := r.gateway.Complete(ctx, traceID, step.StepNo, step.Model, step.Prompt)
		span.Model = step.Model
		span.Provider = "gateway"
		span.Usage = usage
		if err != nil {
			span.Status = trace.StatusFailed
			span.ErrorMessage = err.Error()
		}
	case trace.StepKindWrite:
		if err := sb.WriteFile(step.RelPath, step.Content); err != nil {
			span.Status = classifySandboxErr(err)
			span.ErrorMessage = err.Error()
		} else {
			span.Metadata["rel_path"] = step.RelPath
		}
	case trace.StepKindExec:
		stdout, _, err := sb.RunCommand(ctx, step.Command)
		span.Metadata["stdout"] = stdout
		if err != nil {
			span.Status = classifySandboxErr(err)
			span.ErrorMessage = err.Error()
		}
	default:
		span.Status = trace.StatusFailed
		span.ErrorMessage = fmt.Sprintf("unknown step kind %q", step.Kind)
	}

	span.FinishedAt = time.Now().UTC()
	span.DurationMS = span.FinishedAt.Sub(span.StartedAt).Milliseconds()
	return span
}

func classifySandboxErr(err error) string {
	if errors.Is(err, sandbox.ErrPathEscape) {
		return trace.StatusFailed
	}
	if strings.Contains(err.Error(), "timeout") {
		return trace.StatusTimeout
	}
	return trace.StatusFailed
}

func newTraceID() string {
	return "trace_" + randomHex(8)
}

func newSpanID() string {
	return "span_" + randomHex(8)
}

func randomHex(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

// Ensure gateway.Client satisfies ModelCaller.
var _ ModelCaller = (*gateway.Client)(nil)
