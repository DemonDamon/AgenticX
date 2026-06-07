package residency

import "strings"

const (
	ActionAllow           = "allow"
	ActionBlock           = "block"
	ActionRequireApproval = "require_approval"
)

// Result captures cross-border evaluation for audit and enforcement.
type Result struct {
	SrcRegion       string
	DstRegion       string
	CrossBorder     bool
	ResidencyRule   string
	Action          string
	PendingApproval bool
	Blocked         bool
}

// TenantPolicy is tenant-level data residency and cross-border action.
type TenantPolicy struct {
	DataResidency     string
	CrossBorderAction string
}

// NormalizeRegion lowercases known region codes; empty means unknown/same-domain.
func NormalizeRegion(region string) string {
	r := strings.ToLower(strings.TrimSpace(region))
	switch r {
	case "cn", "us", "eu", "ap", "global":
		return r
	default:
		return ""
	}
}

// IsCrossBorder returns true when both regions are set and differ.
func IsCrossBorder(src, dst string) bool {
	src = NormalizeRegion(src)
	dst = NormalizeRegion(dst)
	if src == "" || dst == "" {
		return false
	}
	return src != dst
}

// Judge evaluates cross-border flow per tenant policy (fail-open on unknown regions).
func Judge(src, dst string, policy TenantPolicy) Result {
	src = NormalizeRegion(src)
	dst = NormalizeRegion(dst)
	if policy.DataResidency != "" && src == "" {
		src = NormalizeRegion(policy.DataResidency)
	}
	cross := IsCrossBorder(src, dst)
	action := strings.ToLower(strings.TrimSpace(policy.CrossBorderAction))
	if action == "" {
		action = ActionAllow
	}
	res := Result{
		SrcRegion:     src,
		DstRegion:     dst,
		CrossBorder:   cross,
		ResidencyRule: action,
		Action:        action,
	}
	if !cross {
		res.ResidencyRule = "same_domain"
		return res
	}
	switch action {
	case ActionBlock:
		res.Blocked = true
		res.ResidencyRule = "cross_border:block"
	case ActionRequireApproval:
		res.PendingApproval = true
		res.ResidencyRule = "cross_border:require_approval"
	default:
		res.ResidencyRule = "cross_border:allow"
	}
	return res
}
