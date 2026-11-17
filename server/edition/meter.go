package edition

import (
	"context"
	"time"
)

// Meter is a kind of usage an edition measures and prices itself, such as a
// cloud computer's running time (ADR 0036). Its usage counts against the
// team's and members' point budgets beside model calls, never against a
// provider's budget or a token limit.
type Meter struct {
	// Name is unique on the instance, for example "cloud.vm.2c4g".
	Name string
	// Unit names what Quantity counts, for example "second".
	Unit string
	// Labels and UnitLabels name the meter and its unit for people, by locale
	// ("en", "zh-CN"). Both locales are required.
	Labels, UnitLabels map[string]string
}

// MeterUse asks for points to be held before the metered work starts. The
// public engine checks the team's and the member's point budgets, records the
// hold and calls MeterFunding.ReserveMeter, all in one transaction.
type MeterUse struct {
	TeamID, UserID, Meter string
	// Points is the hold, in exact accounting units (see Amount).
	Points int64
	// For is how long the hold may stay open. An unsettled hold past it is
	// marked lost and stays held until it is settled; it is never released
	// by the engine alone.
	For time.Duration
}

// MeterAdmission and MeterSettlement are what the funding participant sees.
type MeterAdmission struct {
	RequestID, TeamID, UserID, Meter string
	HeldUnits                        int64
}

type MeterSettlement struct {
	RequestID, TeamID, Meter string
	Quantity, Units          int64
}

// MeterFunding moves the edition's own money inside the public transaction,
// with the same rules as ModelFunding: no network I/O, and an error rolls back
// the public counters and the extension's changes together.
type MeterFunding interface {
	ReserveMeter(context.Context, SQLExecutor, MeterAdmission) error
	SettleMeter(context.Context, SQLExecutor, MeterSettlement) error
}

// MeterHost is scoped to the registering extension: it reserves and settles
// only that extension's meters.
type MeterHost struct {
	// Reserve holds points and returns the usage row's id, or a wire error
	// (budget_exhausted, budget_pending_usage) a caller may show to people.
	Reserve func(context.Context, MeterUse) (string, error)
	// Settle records the measured quantity and its points, releases the hold
	// and spends the points. It is idempotent: a settled row is left alone.
	Settle func(ctx context.Context, requestID string, quantity, points int64) error
}
