package policyengine

type RuleKind string

const (
	RuleKindKeyword RuleKind = "keyword"
	RuleKindRegex   RuleKind = "regex"
	RuleKindPII     RuleKind = "pii"
)

type Action string

const (
	ActionBlock  Action = "block"
	ActionRedact Action = "redact"
	ActionWarn   Action = "warn"
)

type Rule struct {
	ID       string   `yaml:"id"`
	Kind     RuleKind `yaml:"kind"`
	Action   Action   `yaml:"action"`
	Severity string   `yaml:"severity"`
	Message  string   `yaml:"message"`

	Keywords []string `yaml:"keywords"`
	Pattern  string   `yaml:"pattern"`
	PIIType  string   `yaml:"pii_type"`
}

type RulePackManifest struct {
	Name        string `yaml:"name"`
	Version     string `yaml:"version"`
	Type        string `yaml:"type"`
	Description string `yaml:"description"`
	Extends     string `yaml:"extends"`
	Rules       []Rule `yaml:"rules"`
}

type HitEvent struct {
	RuleID    string `json:"rule_id"`
	Kind      string `json:"kind"`
	Action    Action `json:"action"`
	Severity  string `json:"severity"`
	Message   string `json:"message"`
	Matched   string `json:"matched"`
	Stage     string `json:"stage"`
	PIIType   string `json:"pii_type,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

type EvaluateResult struct {
	Blocked      bool       `json:"blocked"`
	RedactedText string     `json:"redacted_text"`
	Hits         []HitEvent `json:"hits"`
}
