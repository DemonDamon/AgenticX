package trace

import "time"

const (
	StepKindModel = "model"
	StepKindExec  = "exec"
	StepKindWrite = "write"

	StatusOK      = "ok"
	StatusFailed  = "failed"
	StatusTimeout = "timeout"
)

// Usage captures token consumption for one step.
type Usage struct {
	InputTokens     int     `json:"input_tokens"`
	OutputTokens    int     `json:"output_tokens"`
	ReasoningTokens int     `json:"reasoning_tokens"`
	TotalTokens     int     `json:"total_tokens"`
	CostUSD         float64 `json:"cost_usd"`
}

// Span is one agent step in a trace.
type Span struct {
	ID              string         `json:"id"`
	TraceID         string         `json:"trace_id"`
	StepNo          int            `json:"step_no"`
	StepKind        string         `json:"step_kind"`
	Status          string         `json:"status"`
	Model           string         `json:"model,omitempty"`
	Provider        string         `json:"provider,omitempty"`
	Usage           Usage          `json:"usage"`
	DurationMS      int64          `json:"duration_ms"`
	ErrorMessage    string         `json:"error_message,omitempty"`
	Metadata        map[string]any `json:"metadata,omitempty"`
	StartedAt       time.Time      `json:"started_at"`
	FinishedAt      time.Time      `json:"finished_at"`
}

// Trace aggregates spans for one agent task run.
type Trace struct {
	TraceID     string    `json:"trace_id"`
	Spans       []Span    `json:"spans"`
	TotalUsage  Usage     `json:"total_usage"`
	StartedAt   time.Time `json:"started_at"`
	FinishedAt  time.Time `json:"finished_at"`
	Status      string    `json:"status"`
}

func SumUsage(spans []Span) Usage {
	var total Usage
	for _, span := range spans {
		total.InputTokens += span.Usage.InputTokens
		total.OutputTokens += span.Usage.OutputTokens
		total.ReasoningTokens += span.Usage.ReasoningTokens
		total.TotalTokens += span.Usage.TotalTokens
		total.CostUSD += span.Usage.CostUSD
	}
	return total
}

func AggregateTrace(traceID string, spans []Span) Trace {
	total := SumUsage(spans)
	status := StatusOK
	for _, span := range spans {
		if span.Status != StatusOK {
			status = span.Status
			break
		}
	}
	started := time.Now().UTC()
	finished := started
	if len(spans) > 0 {
		started = spans[0].StartedAt
		finished = spans[len(spans)-1].FinishedAt
	}
	return Trace{
		TraceID:    traceID,
		Spans:      spans,
		TotalUsage: total,
		StartedAt:  started,
		FinishedAt: finished,
		Status:     status,
	}
}
