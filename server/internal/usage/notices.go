package usage

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetnotice"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/budgetpolicy"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/ids"
)

//go:embed messages/*.json
var noticeMessages embed.FS

type NoticeMessage struct{ To, Subject, Text, ID string }

type noticeData struct {
	AppURL                                                    string
	Scope, SubjectID, Period                                  string
	Spent, Limit                                              string
	Input, InputLimit, Output, OutputLimit, Total, TotalLimit *int64
	Reset                                                     time.Time
}

func crossed(spent int64, limit *int64) int {
	if limit == nil || spent == 0 {
		return 0
	}
	if spent >= *limit {
		return 100
	}
	if spent >= *limit-*limit/20 {
		return 95
	}
	if spent >= *limit-*limit/5 {
		return 80
	}
	return 0
}

func effectivePolicy(ctx context.Context, db *ent.Client, w *ent.BudgetWindow) (*ent.BudgetPolicy, error) {
	rows, err := db.BudgetPolicy.Query().Where(budgetpolicy.TeamID(w.TeamID), budgetpolicy.PeriodEQ(budgetpolicy.Period(w.Period))).All(ctx)
	if err != nil {
		return nil, err
	}
	return windowPolicy(rows, w), nil
}

func windowPolicy(rows []*ent.BudgetPolicy, w *ent.BudgetWindow) *ent.BudgetPolicy {
	var fallback *ent.BudgetPolicy
	for _, p := range rows {
		if string(p.Period) != string(w.Period) {
			continue
		}
		if w.Scope == "member" && p.Scope == "default_member" {
			fallback = p
		}
		if string(p.Scope) == string(w.Scope) && p.SubjectID == w.SubjectID && !inheritsDefault(p) {
			return p
		}
	}
	return fallback
}

func currentNotice(w *ent.BudgetWindow, p *ent.BudgetPolicy, appURL string) (noticeData, int, error) {
	total, err := addProduct(w.SpentInput, w.SpentOutput, 1)
	if err != nil {
		return noticeData{}, 0, err
	}
	level := max(crossed(w.SpentInput, p.InputLimit), crossed(w.SpentOutput, p.OutputLimit), crossed(total, p.TotalLimit))
	if w.UnpricedCount == 0 {
		level = max(level, crossed(w.SpentUnits, p.PointLimit))
	}
	data := noticeData{AppURL: appURL, Scope: string(w.Scope), SubjectID: w.SubjectID, Period: string(w.Period), Spent: FormatPoints(w.SpentUnits),
		Input: &w.SpentInput, InputLimit: p.InputLimit, Output: &w.SpentOutput, OutputLimit: p.OutputLimit, Total: &total, TotalLimit: p.TotalLimit, Reset: w.EndsAt}
	if p.PointLimit != nil && w.UnpricedCount == 0 {
		data.Limit = FormatPoints(*p.PointLimit)
	}
	return data, level, nil
}

// enqueueNotices runs within the same transaction as usage settlement.
func enqueueNotices(ctx context.Context, db *ent.Client, windowID, appURL string, now time.Time) error {
	w, err := db.BudgetWindow.Get(ctx, windowID)
	if err != nil {
		return err
	}
	p, err := effectivePolicy(ctx, db, w)
	if err != nil || p == nil || !p.Enabled || p.Notify == "none" {
		return err
	}
	data, level, err := currentNotice(w, p, appURL)
	if err != nil || level == 0 {
		return err
	}
	payload, _ := json.Marshal(data)
	query := db.Membership.Query().Where(membership.TeamID(w.TeamID))
	if w.Scope == "member" && p.Notify == "owner" {
		query.Where(membership.UserID(w.SubjectID))
	} else if w.Scope == "member" && p.Notify == "both" {
		query.Where(membership.Or(membership.RoleEQ(membership.RoleAdmin), membership.UserID(w.SubjectID)))
	} else {
		query.Where(membership.RoleEQ(membership.RoleAdmin))
	}
	recipients, err := query.All(ctx)
	if err != nil {
		return err
	}
	for _, recipient := range recipients {
		if err := db.BudgetNotice.Create().SetCreatedAt(now).SetNextAt(now).SetTeamID(w.TeamID).SetWindowID(w.ID).SetRecipientID(recipient.UserID).
			SetThreshold(level).SetData(payload).OnConflictColumns(budgetnotice.FieldWindowID, budgetnotice.FieldRecipientID, budgetnotice.FieldThreshold).Ignore().Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

type noticeWords struct {
	Subject, Intro, Points, Input, Output, Total, Reset, Manage, Footer string
	Scopes                                                              map[string]string
}

func (s *Service) noticeMessage(ctx context.Context, notice *ent.BudgetNotice) (NoticeMessage, bool, error) {
	m, err := s.DB.Membership.Query().Where(membership.TeamID(notice.TeamID), membership.UserID(notice.RecipientID)).WithUser().Only(ctx)
	if ent.IsNotFound(err) {
		return NoticeMessage{}, false, nil
	}
	if err != nil {
		return NoticeMessage{}, false, err
	}
	var data noticeData
	if err := json.Unmarshal(notice.Data, &data); err != nil {
		return NoticeMessage{}, false, err
	}
	if m.Role != membership.RoleAdmin && (data.Scope != "member" || data.SubjectID != m.UserID) {
		return NoticeMessage{}, false, nil
	}
	w, err := s.DB.BudgetWindow.Get(ctx, notice.WindowID)
	if err != nil {
		return NoticeMessage{}, false, err
	}
	if !s.now().Before(w.EndsAt) {
		return NoticeMessage{}, false, nil
	}
	policy, err := effectivePolicy(ctx, s.DB, w)
	if err != nil {
		return NoticeMessage{}, false, err
	}
	if policy == nil || !policy.Enabled || policy.Notify == "none" || policy.Notify == "owner" && m.UserID != data.SubjectID || policy.Notify == "admins" && m.Role != membership.RoleAdmin {
		return NoticeMessage{}, false, nil
	}
	// A queued alert can outlive a raised cap or a usage correction. Keep the
	// immutable event snapshot, but never send an obsolete threshold/allowance.
	data, level, err := currentNotice(w, policy, data.AppURL)
	if err != nil || level < notice.Threshold {
		return NoticeMessage{}, false, err
	}
	user := m.Edges.User
	if user == nil || user.Email == nil {
		return NoticeMessage{}, false, nil
	}
	team, err := s.DB.Team.Get(ctx, notice.TeamID)
	if err != nil {
		return NoticeMessage{}, false, err
	}
	locale := "en"
	if user.Locale != nil && *user.Locale == "zh-CN" {
		locale = "zh-CN"
	}
	raw, err := noticeMessages.ReadFile("messages/" + locale + ".json")
	if err != nil {
		return NoticeMessage{}, false, err
	}
	var words noticeWords
	if err := json.Unmarshal(raw, &words); err != nil {
		return NoticeMessage{}, false, err
	}
	scope := words.Scopes[data.Scope]
	if data.Scope == "provider" {
		scope += " · " + data.SubjectID
	}
	if data.Scope == "member" {
		owner, err := s.DB.User.Get(ctx, data.SubjectID)
		if err == nil && owner.Email != nil {
			scope += " · " + *owner.Email
		}
		if err != nil && !ent.IsNotFound(err) {
			return NoticeMessage{}, false, err
		}
	}
	lines := []string{fmt.Sprintf(words.Intro, team.Name, notice.Threshold, scope), ""}
	if data.Limit != "" {
		lines = append(lines, fmt.Sprintf(words.Points, data.Spent, data.Limit))
	}
	for _, v := range []struct {
		label       string
		used, limit *int64
	}{{words.Input, data.Input, data.InputLimit}, {words.Output, data.Output, data.OutputLimit}, {words.Total, data.Total, data.TotalLimit}} {
		if v.used != nil && v.limit != nil {
			lines = append(lines, fmt.Sprintf(v.label, *v.used, *v.limit))
		}
	}
	base := data.AppURL
	if base == "" {
		base = s.AppURL
	}
	link := strings.TrimRight(base, "/") + "/teams/" + url.PathEscape(notice.TeamID) + "/budgets"
	lines = append(lines, "", fmt.Sprintf(words.Reset, data.Reset.UTC().Format(time.RFC3339)), fmt.Sprintf(words.Manage, link), "", words.Footer)
	name := strings.NewReplacer("\r", " ", "\n", " ").Replace(team.Name)
	return NoticeMessage{To: *user.Email, ID: "budget-" + notice.ID, Subject: fmt.Sprintf(words.Subject, name), Text: strings.Join(lines, "\n")}, true, nil
}

func (s *Service) DeliverNotices(ctx context.Context) error {
	if s.SendNotice == nil {
		return nil
	}
	now := s.now()
	rows, err := s.DB.BudgetNotice.Query().Where(budgetnotice.Or(
		budgetnotice.And(budgetnotice.StateEQ(budgetnotice.StatePending), budgetnotice.NextAtLTE(now)),
		budgetnotice.And(budgetnotice.StateEQ(budgetnotice.StateSending), budgetnotice.LeaseUntilLTE(now)),
	)).Order(ent.Asc(budgetnotice.FieldCreatedAt)).Limit(20).All(ctx)
	if err != nil {
		return err
	}
	for _, notice := range rows {
		lease := ids.New()
		claimed, err := s.DB.BudgetNotice.Update().Where(budgetnotice.ID(notice.ID), budgetnotice.Attempts(notice.Attempts), budgetnotice.Or(
			budgetnotice.And(budgetnotice.StateEQ(budgetnotice.StatePending), budgetnotice.NextAtLTE(now)),
			budgetnotice.And(budgetnotice.StateEQ(budgetnotice.StateSending), budgetnotice.LeaseUntilLTE(now)))).
			SetState(budgetnotice.StateSending).SetLeaseID(lease).SetLeaseUntil(now.Add(2 * time.Minute)).AddAttempts(1).Save(ctx)
		if err != nil {
			return err
		}
		if claimed != 1 {
			continue
		}
		higher, err := s.DB.BudgetNotice.Query().Where(budgetnotice.WindowID(notice.WindowID), budgetnotice.RecipientID(notice.RecipientID), budgetnotice.ThresholdGT(notice.Threshold)).Exist(ctx)
		if err != nil {
			return err
		}
		message, allowed, err := s.noticeMessage(ctx, notice)
		state, code := budgetnotice.StateSent, ""
		if err == nil && (!allowed || higher) {
			state = budgetnotice.StateSkipped
		} else if err == nil {
			err = s.SendNotice(ctx, message)
		}
		attempts := notice.Attempts + 1
		if err != nil {
			state, code = budgetnotice.StatePending, "mail_delivery_failed"
			var smtpError *textproto.Error
			if attempts >= 5 || errors.As(err, &smtpError) && smtpError.Code >= 500 {
				state = budgetnotice.StateFailed
			}
		}
		next := s.now().Add(time.Minute*time.Duration(1<<min(attempts, 6)) + time.Duration(rand.IntN(30))*time.Second)
		if state == budgetnotice.StateFailed {
			next = s.now().Add(time.Minute)
		}
		if _, err := s.DB.BudgetNotice.Update().Where(budgetnotice.ID(notice.ID), budgetnotice.LeaseID(lease)).
			SetState(state).SetLastError(code).SetNextAt(next).ClearLeaseUntil().SetLeaseID("").Save(ctx); err != nil {
			return err
		}
	}
	return nil
}
