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
	ID        string     `yaml:"id" json:"id"`
	TenantID  string     `yaml:"tenant_id,omitempty" json:"tenant_id,omitempty"`
	Kind      RuleKind   `yaml:"kind" json:"kind"`
	Action    Action     `yaml:"action" json:"action"`
	Severity  string     `yaml:"severity" json:"severity"`
	Message   string     `yaml:"message" json:"message"`
	AppliesTo *AppliesTo `yaml:"applies_to,omitempty" json:"applies_to,omitempty"`

	Keywords []string `yaml:"keywords" json:"keywords,omitempty"`
	Pattern  string   `yaml:"pattern" json:"pattern,omitempty"`
	PIIType  string   `yaml:"pii_type" json:"pii_type,omitempty"`
}

type RulePackManifest struct {
	Name        string     `yaml:"name" json:"name"`
	Version     string     `yaml:"version" json:"version"`
	Type        string     `yaml:"type" json:"type"`
	Description string     `yaml:"description" json:"description"`
	Extends     string     `yaml:"extends" json:"extends"`
	AppliesTo   *AppliesTo `yaml:"applies_to,omitempty" json:"applies_to,omitempty"`
	Rules       []Rule     `yaml:"rules" json:"rules"`
}

type AppliesTo struct {
	Version             int      `yaml:"version" json:"version"`
	DepartmentIDs       []string `yaml:"departmentIds" json:"departmentIds"`
	DepartmentRecursive bool     `yaml:"departmentRecursive" json:"departmentRecursive"`
	RoleCodes           []string `yaml:"roleCodes" json:"roleCodes"`
	UserIDs             []string `yaml:"userIds" json:"userIds"`
	UserExcludeIDs      []string `yaml:"userExcludeIds" json:"userExcludeIds"`
	ClientTypes         []string `yaml:"clientTypes" json:"clientTypes"`
	Stages              []string `yaml:"stages" json:"stages"`
}

type EvalContext struct {
	TenantID   string
	DeptIDs    []string
	RoleCodes  []string
	UserID     string
	ClientType string
	Stage      string
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
