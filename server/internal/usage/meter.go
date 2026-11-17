package usage

import (
	"context"
	"errors"
	"maps"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/edition"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetreservation"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/usagerequest"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// A registered meter: an edition's own kind of usage, priced by it and counted
// against the same team and member point budgets as model calls (ADR 0036).
type registeredMeter struct {
	owner   string
	meter   edition.Meter
	funding edition.MeterFunding
}

var (
	meterName = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{0,63}$`)
	meterUnit = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
)

// The longest a meter hold may stay open before it is marked lost.
const MaxMeterHold = 24 * time.Hour

func validLabels(labels map[string]string) bool {
	if len(labels) != 2 {
		return false
	}
	for _, locale := range []string{"en", "zh-CN"} {
		l := strings.TrimSpace(labels[locale])
		if l == "" || utf8.RuneCountInString(l) > 100 {
			return false
		}
	}
	return true
}

// RegisterMeters binds an extension's meters once, during its Mount.
func (s *Service) RegisterMeters(owner string, meters []edition.Meter, funding edition.MeterFunding) (edition.MeterHost, error) {
	if owner == "" || len(owner) > 40 || funding == nil || len(meters) == 0 {
		return edition.MeterHost{}, errors.New("invalid meter registration")
	}
	if s.Meters == nil {
		s.Meters = map[string]registeredMeter{}
	}
	for _, m := range s.Meters {
		if m.owner == owner {
			return edition.MeterHost{}, errors.New("duplicate meter registration")
		}
	}
	added := map[string]registeredMeter{}
	for _, m := range meters {
		if !meterName.MatchString(m.Name) || !meterUnit.MatchString(m.Unit) || !validLabels(m.Labels) || !validLabels(m.UnitLabels) {
			return edition.MeterHost{}, errors.New("invalid meter " + m.Name)
		}
		if _, taken := s.Meters[m.Name]; taken {
			return edition.MeterHost{}, errors.New("duplicate meter " + m.Name)
		}
		if _, taken := added[m.Name]; taken {
			return edition.MeterHost{}, errors.New("duplicate meter " + m.Name)
		}
		// Copied, so the registering extension cannot change them afterwards.
		m.Labels, m.UnitLabels = maps.Clone(m.Labels), maps.Clone(m.UnitLabels)
		added[m.Name] = registeredMeter{owner: owner, meter: m, funding: funding}
	}
	for name, m := range added {
		s.Meters[name] = m
	}
	return edition.MeterHost{
		Reserve: func(ctx context.Context, use edition.MeterUse) (string, error) {
			return s.reserveMeter(ctx, owner, use)
		},
		Settle: func(ctx context.Context, requestID string, quantity, points int64) error {
			return s.settleMeter(ctx, owner, requestID, quantity, points)
		},
	}, nil
}

// reserveMeter holds points in every applicable team and member window and in
// the owner's funding, in one transaction. The caller has already decided that
// the member may use what it meters: the engine checks budgets, not access.
func (s *Service) reserveMeter(ctx context.Context, owner string, use edition.MeterUse) (string, error) {
	m, ok := s.Meters[use.Meter]
	if !ok || m.owner != owner {
		return "", errors.New("meter not registered by this extension")
	}
	if use.TeamID == "" || len(use.TeamID) > 32 || use.UserID == "" || len(use.UserID) > 32 || use.Points <= 0 ||
		use.For < time.Minute || use.For > MaxMeterHold {
		return "", errors.New("invalid meter use")
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	db := tx.Client()
	if err := lockTeam(ctx, db, use.TeamID); err != nil {
		return "", err
	}
	// No provider is named, so only team and member policies apply.
	policies, err := applicable(ctx, db, Call{TeamID: use.TeamID, UserID: use.UserID})
	if err != nil {
		return "", err
	}
	now := s.now()
	request, err := db.UsageRequest.Create().SetCreatedAt(now).SetDeadlineAt(now.Add(use.For)).SetAppURL(s.AppURL).
		SetTeamID(use.TeamID).SetUserID(use.UserID).SetSubmittedConfigID("").SetConfigID("").SetProvider("").SetModel("").
		SetStream(false).SetRouteOwner(owner).SetMeter(use.Meter).
		SetAdmittedUnits(use.Points).SetAdmittedInput(0).SetAdmittedOutput(0).Save(ctx)
	if err != nil {
		return "", err
	}
	if err := reserve(ctx, db, use.TeamID, use.UserID, request.ID, policies, use.Points, Tokens{}, true, true, now); err != nil {
		return "", err
	}
	in := edition.MeterAdmission{RequestID: request.ID, TeamID: use.TeamID, UserID: use.UserID, Meter: use.Meter, HeldUnits: use.Points}
	if err := Participate(db, use.TeamID, owner, func(tx edition.SQLExecutor) error { return m.funding.ReserveMeter(ctx, tx, in) }); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return request.ID, nil
}

// settleMeter spends the measured points and releases the hold, in the windows
// and in the owner's funding together. A hold marked lost is settled the same
// way; a settled one is left alone.
func (s *Service) settleMeter(ctx context.Context, owner, requestID string, quantity, points int64) error {
	if quantity < 0 || points < 0 {
		return errors.New("invalid meter settlement")
	}
	found, err := s.DB.UsageRequest.Get(ctx, requestID)
	if err != nil {
		return err
	}
	m, ok := s.Meters[found.Meter]
	if found.Meter == "" || found.RouteOwner != owner || !ok || m.owner != owner {
		return errors.New("meter usage of another extension")
	}
	tx, err := s.DB.Tx(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	db := tx.Client()
	if err := lockTeam(ctx, db, found.TeamID); err != nil {
		return err
	}
	current, err := db.UsageRequest.Get(ctx, requestID)
	if err != nil {
		return err
	}
	if current.State != usagerequest.StateRunning && current.State != usagerequest.StatePending {
		return nil
	}
	code := ""
	if current.AdmittedUnits != nil && points > *current.AdmittedUnits {
		code = "usage_bound_exceeded"
	}
	out := edition.MeterSettlement{RequestID: current.ID, TeamID: current.TeamID, Meter: current.Meter, Quantity: quantity, Units: points}
	if err := Participate(db, current.TeamID, owner, func(tx edition.SQLExecutor) error { return m.funding.SettleMeter(ctx, tx, out) }); err != nil {
		return err
	}
	reservations, err := db.BudgetReservation.Query().Where(budgetreservation.RequestID(current.ID), budgetreservation.Settled(false)).All(ctx)
	if err != nil {
		return err
	}
	now := s.now()
	for _, held := range reservations {
		if err := settleWindow(ctx, db, current, held, Tokens{}, &points, now); err != nil {
			return err
		}
	}
	changed, err := db.UsageRequest.Update().Where(usagerequest.ID(current.ID), usagerequest.StateIn(usagerequest.StateRunning, usagerequest.StatePending)).
		SetState(usagerequest.StateSettled).SetFinishedAt(now).SetErrorCode(code).SetPointUnits(points).SetQuantity(quantity).Save(ctx)
	if err != nil {
		return err
	}
	if changed != 1 {
		return errors.New("usage changed during settlement")
	}
	return tx.Commit()
}

// MeterView names a metered entry for people; nil on a model call.
type MeterView struct {
	Name       string            `json:"name"`
	Unit       string            `json:"unit"`
	Quantity   *int64            `json:"quantity"`
	Labels     map[string]string `json:"labels"`
	UnitLabels map[string]string `json:"unitLabels"`
}

func (s *Service) meterView(name string, quantity *int64) *MeterView {
	if name == "" {
		return nil
	}
	v := &MeterView{Name: name, Quantity: quantity, Labels: map[string]string{}, UnitLabels: map[string]string{}}
	if m, ok := s.Meters[name]; ok {
		v.Unit, v.Labels, v.UnitLabels = m.meter.Unit, m.meter.Labels, m.meter.UnitLabels
	}
	return v
}

var errMeterOwned = wire.E(http.StatusConflict, "usage_meter_owned")
