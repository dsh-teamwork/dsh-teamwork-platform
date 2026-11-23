package edition

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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
//
// MaxInput and MaxOutput are the route's trusted bounds: the most input tokens
// a call may carry and the most output it may ask for, which size the hold.
// Body is merged into the upstream request after the caller's fields have been
// checked, so no caller can set or override it (an aggregator's routing
// object, say); it never names a field the gateway forwards.
type FundingQuote struct {
	RateID, Model, BaseURL, APIKey string
	Revision                       int
	Rates                          Rates
	MaxInput, MaxOutput            int64
	Vision                         bool
	Body                           map[string]json.RawMessage
}

// FundingAdmission is one call to fund.
type FundingAdmission struct {
	RequestID, TeamID, UserID, ConfigID, Reference, Model, RateID string
	HeldUnits                                                     int64
}

// FundingSettlement is a call's observed usage. UpstreamCost is the price the
// upstream itself reported for the call, verbatim as a decimal string in its
// own billing currency (OpenRouter's usage.cost, in US dollars); it is empty
// when the upstream reported none, and always empty for an estimate.
type FundingSettlement struct {
	RequestID, TeamID string
	Units             int64
	Tokens            Tokens
	UpstreamCost      string
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
// follow the same lock order as inference. PublishModel creates an owned
// route in a team, unusable if its funding participant is absent; publishing
// it again refreshes its name and bounds, so members' plugins sync the change.
type FundingHost struct {
	WithTeamTx   func(context.Context, string, func(SQLExecutor) error) error
	PublishModel func(ctx context.Context, tx SQLExecutor, teamID string, m OwnedModel) error
}

// ErrTeamGone is PublishModel refusing a team that no longer exists, whose
// configuration went with it: an extension's own record of the team outlived it.
var ErrTeamGone = errors.New("team no longer exists")

// OwnedModel is one owned route as a team's configuration shows it. Its
// bounds are what the plugin sizes the model by (contextWindow, maxTokens),
// each from 1 to 10,000,000 as every team model's are. Offline keeps the
// configuration in the team but marks the model out of service: the plugin
// offers it to no session and the console says so; publishing it again
// without Offline brings it back.
type OwnedModel struct {
	ConfigID, Name, Reference string
	ContextWindow, MaxTokens  int64
	Vision                    *bool
	ReasoningEfforts          []string
	Offline                   bool
}

// FundingError carries a safe public refusal, without supplier response text.
type FundingError struct {
	Code   string
	Status int
}

func (e *FundingError) Error() string     { return fmt.Sprintf("funding: %s", e.Code) }
func (e *FundingError) HTTPStatus() int   { return e.Status }
func (e *FundingError) ErrorCode() string { return e.Code }
