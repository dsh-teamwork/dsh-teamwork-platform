package edition

import (
	"context"
	"database/sql"
	"fmt"
)

// SQLExecutor is borrowed only for the duration of a callback. It exposes no
// transaction controls. An extension accesses only its own tables through it.
type SQLExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// ModelReference has already passed the public team's membership checks.
type ModelReference struct{ TeamID, ConfigID, Reference string }

// FundingQuote is server-only. APIKey and BaseURL are never configuration data
// or usage facts. Rates uses the same exact units as community accounting.
type FundingQuote struct {
	RateID, Model, BaseURL, APIKey string
	Revision                       int
	Rates                          Rates
}

// FundingAdmission is one call to fund. A shared DSH's call (ADR 0047) has a
// HostID and no UserID.
type FundingAdmission struct {
	RequestID, TeamID, UserID, HostID, ConfigID, Reference, Model, RateID string
	HeldUnits                                                             int64
}

type FundingSettlement struct {
	RequestID, TeamID string
	Units             int64
	Tokens            Tokens
	Estimated         bool
	ActorID, Reason   string
}

// ModelFunding participates in the public admission/settlement transaction.
// Quote performs no financial mutation. Reserve and Settle do no network I/O;
// errors roll back public counters and extension changes together. Missing or
// ambiguous usage never invokes Settle and never releases a monetary hold.
type ModelFunding interface {
	Quote(context.Context, ModelReference) (FundingQuote, error)
	Reserve(context.Context, SQLExecutor, FundingAdmission) error
	Settle(context.Context, SQLExecutor, FundingSettlement) error
}

// FundingHost is scoped to the registering extension's name. Team callbacks
// follow the same lock order as inference. PublishModel creates an immutable
// owned route, unusable if its funding participant is absent.
type FundingHost struct {
	WithTeamTx   func(context.Context, string, func(SQLExecutor) error) error
	PublishModel func(context.Context, SQLExecutor, string, string, string, string) error
}

// FundingError carries a safe public refusal, without supplier response text.
type FundingError struct {
	Code   string
	Status int
}

func (e *FundingError) Error() string     { return fmt.Sprintf("funding: %s", e.Code) }
func (e *FundingError) HTTPStatus() int   { return e.Status }
func (e *FundingError) ErrorCode() string { return e.Code }
