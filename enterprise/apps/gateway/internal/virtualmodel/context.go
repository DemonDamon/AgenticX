package virtualmodel

import (
	"context"
	"strings"
)

type planContextKey struct{}

type plannedRoute struct {
	Order []string
	Name  string
}

// WithPlan attaches one already chosen target order so a later Executor call
// uses the same first model as the quota pre-check.
func WithPlan(ctx context.Context, order []string, name string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	copied := append([]string(nil), order...)
	return context.WithValue(ctx, planContextKey{}, plannedRoute{Order: copied, Name: strings.TrimSpace(name)})
}

// PlanFromContext returns the plan attached by WithPlan.
func PlanFromContext(ctx context.Context) (order []string, name string, ok bool) {
	if ctx == nil {
		return nil, "", false
	}
	value, found := ctx.Value(planContextKey{}).(plannedRoute)
	if !found || len(value.Order) == 0 || value.Name == "" {
		return nil, "", false
	}
	return value.Order, value.Name, true
}
