package usage

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/modelrate"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

type Service struct {
	DB         *ent.Client
	Now        func() time.Time
	AppURL     string
	SendNotice func(context.Context, NoticeMessage) error
}

const MaxCallDuration = 15 * time.Minute

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Call is resolved by the gateway, never populated from caller identity fields.
type Call struct {
	TeamID, UserID, SubmittedConfigID, ConfigID, Provider, Model string
	Stream                                                       bool
	Bounds                                                       func() (Tokens, error)
}

func (s *Service) latestRate(ctx context.Context, teamID, configID string) (*ent.ModelRate, error) {
	r, err := s.DB.ModelRate.Query().Where(modelrate.TeamID(teamID), modelrate.ConfigID(configID)).
		Order(ent.Desc(modelrate.FieldRevision)).First(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	return r, err
}

func ratesOf(r *ent.ModelRate) Rates {
	return Rates{Input: r.InputRate, CacheRead: r.CacheReadRate, CacheWrite: r.CacheWriteRate, Output: r.OutputRate}
}

// RateView exposes human-entered CNY/million-token decimals, not provider costs
// or redeemable credit. Revision remains monotonic after model route changes.
type RateView struct {
	Configured bool   `json:"configured"`
	Revision   int    `json:"revision"`
	Basis      string `json:"basis"`
	Input      string `json:"input"`
	CacheRead  string `json:"cacheRead"`
	CacheWrite string `json:"cacheWrite"`
	Output     string `json:"output"`
}

func rateDecimal(rate int64) string {
	return strconv.FormatInt(rate/1_000_000, 10) + "." + strconv.FormatInt(1_000_000+rate%1_000_000, 10)[1:]
}

func (s *Service) Rate(ctx context.Context, teamID, configID, provider, model string) (RateView, error) {
	r, err := s.latestRate(ctx, teamID, configID)
	v := RateView{Basis: "cost", Input: "", CacheRead: "", CacheWrite: "", Output: ""}
	if err != nil || r == nil {
		return v, err
	}
	v.Revision = r.Revision
	if r.Provider != provider || r.Model != model {
		return v, nil
	}
	v.Configured, v.Basis = true, string(r.Basis)
	v.Input, v.CacheRead, v.CacheWrite, v.Output = rateDecimal(r.InputRate), rateDecimal(r.CacheReadRate), rateDecimal(r.CacheWriteRate), rateDecimal(r.OutputRate)
	return v, nil
}

type RateInput struct {
	Revision   int    `json:"revision"`
	Basis      string `json:"basis"`
	Input      string `json:"input"`
	CacheRead  string `json:"cacheRead"`
	CacheWrite string `json:"cacheWrite"`
	Output     string `json:"output"`
}

func (in *RateInput) Validate() error {
	var issues wire.Issues
	if in.Revision < 0 || in.Revision > 1_000_000_000 {
		issues.Add("A valid rate revision", "revision")
	}
	if in.Basis != "cost" && in.Basis != "weight" {
		issues.Add("cost or weight", "basis")
	}
	for _, f := range []struct{ name, value string }{{"input", in.Input}, {"cacheRead", in.CacheRead}, {"cacheWrite", in.CacheWrite}, {"output", in.Output}} {
		if n, err := Decimal(f.value, 6); err != nil || n > 1_000_000_000_000 {
			issues.Add("A nonnegative decimal up to 1000000, with at most six decimal places", f.name)
		}
	}
	return issues.Err()
}

func (s *Service) SetRate(ctx context.Context, call Call, in RateInput) (RateView, error) {
	if err := in.Validate(); err != nil {
		return RateView{}, err
	}
	current, err := s.latestRate(ctx, call.TeamID, call.ConfigID)
	if err != nil {
		return RateView{}, err
	}
	revision := 0
	if current != nil {
		revision = current.Revision
	}
	if revision != in.Revision {
		return RateView{}, wire.E(http.StatusConflict, "rate_changed")
	}
	input, _ := Decimal(in.Input, 6)
	read, _ := Decimal(in.CacheRead, 6)
	write, _ := Decimal(in.CacheWrite, 6)
	output, _ := Decimal(in.Output, 6)
	_, err = s.DB.ModelRate.Create().SetTeamID(call.TeamID).SetConfigID(call.ConfigID).
		SetProvider(call.Provider).SetModel(call.Model).SetRevision(revision + 1).SetActorID(call.UserID).
		SetBasis(modelrate.Basis(in.Basis)).SetInputRate(input).SetCacheReadRate(read).SetCacheWriteRate(write).SetOutputRate(output).Save(ctx)
	if ent.IsConstraintError(err) {
		return RateView{}, wire.E(http.StatusConflict, "rate_changed")
	}
	if err != nil {
		return RateView{}, err
	}
	return s.Rate(ctx, call.TeamID, call.ConfigID, call.Provider, call.Model)
}

// Begin captures the price before dispatch; adding or editing a rate later
// cannot change the price of a request already accepted.
func (s *Service) Begin(ctx context.Context, call Call) (*ent.UsageRequest, error) {
	return s.admit(ctx, call)
}

// Finish is idempotent. Incomplete or unmeasurable responses remain pending,
// including a transport error after an upstream may have accepted the request.
func (s *Service) Finish(ctx context.Context, request *ent.UsageRequest, observation Observation, code string) error {
	return s.settle(ctx, request, observation, code)
}

// EntryView is the stable JSON surface; nil points mean unpriced or pending,
// not zero. Internal rates and provider credentials are never returned.
type EntryView struct {
	ID         string  `json:"id"`
	UserID     string  `json:"userId"`
	ConfigID   string  `json:"configId"`
	Provider   string  `json:"provider"`
	Model      string  `json:"model"`
	State      string  `json:"state"`
	Code       string  `json:"code"`
	CreatedAt  string  `json:"createdAt"`
	FinishedAt *string `json:"finishedAt"`
	Input      *int64  `json:"input"`
	CacheRead  *int64  `json:"cacheRead"`
	CacheWrite *int64  `json:"cacheWrite"`
	Output     *int64  `json:"output"`
	Reasoning  *int64  `json:"reasoning"`
	Points     *string `json:"points"`
}

type Filter struct {
	TeamID, UserID, ConfigID string
	Since, Until             time.Time
	Page, Size               int
}

func (s *Service) query(f Filter) *ent.UsageRequestQuery {
	q := s.DB.UsageRequest.Query().Where(usagerequest.TeamID(f.TeamID))
	if f.UserID != "" {
		q.Where(usagerequest.UserID(f.UserID))
	}
	if f.ConfigID != "" {
		q.Where(usagerequest.ConfigID(f.ConfigID))
	}
	if !f.Since.IsZero() {
		q.Where(usagerequest.CreatedAtGTE(f.Since))
	}
	if !f.Until.IsZero() {
		q.Where(usagerequest.CreatedAtLT(f.Until))
	}
	return q
}

type Page struct {
	Entries []EntryView `json:"entries"`
	Total   int         `json:"total"`
	Page    int         `json:"page"`
	Size    int         `json:"size"`
}

func (s *Service) List(ctx context.Context, f Filter) (Page, error) {
	total, err := s.query(f).Count(ctx)
	if err != nil {
		return Page{}, err
	}
	rows, err := s.query(f).Order(ent.Desc(usagerequest.FieldCreatedAt), ent.Desc(usagerequest.FieldID)).
		Offset((f.Page - 1) * f.Size).Limit(f.Size).All(ctx)
	if err != nil {
		return Page{}, err
	}
	p := Page{Entries: []EntryView{}, Total: total, Page: f.Page, Size: f.Size}
	for _, r := range rows {
		p.Entries = append(p.Entries, entryView(r))
	}
	return p, nil
}

func entryView(r *ent.UsageRequest) EntryView {
	v := EntryView{ID: r.ID, UserID: r.UserID, ConfigID: r.ConfigID, Provider: r.Provider, Model: r.Model,
		State: string(r.State), Code: r.ErrorCode, CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339Nano),
		Input: r.InputTokens, CacheRead: r.CacheReadTokens, CacheWrite: r.CacheWriteTokens, Output: r.OutputTokens, Reasoning: r.ReasoningTokens}
	if r.FinishedAt != nil {
		at := r.FinishedAt.UTC().Format(time.RFC3339Nano)
		v.FinishedAt = &at
	}
	if r.PointUnits != nil {
		points := FormatPoints(*r.PointUnits)
		v.Points = &points
	}
	return v
}

// Export fails before writing anything when the bounded result is too large.
// A single query avoids offset drift while calls are being created or settled.
func (s *Service) Export(ctx context.Context, f Filter) ([]EntryView, error) {
	rows, err := s.query(f).Order(ent.Desc(usagerequest.FieldCreatedAt), ent.Desc(usagerequest.FieldID)).Limit(10001).All(ctx)
	if err != nil {
		return nil, err
	}
	if len(rows) > 10000 {
		return nil, wire.E(http.StatusRequestEntityTooLarge, "usage_export_too_large")
	}
	entries := make([]EntryView, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, entryView(row))
	}
	return entries, nil
}
