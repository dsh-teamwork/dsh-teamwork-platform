package manage

import (
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/membership"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/team"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/user"
	"net/http"
	"strings"
)

func listTeams(a *api, w http.ResponseWriter, r *http.Request, _ actor) error {
	q := r.URL.Query()
	page, err := intParam(q, "page", 1, 1, 1<<30)
	if err != nil {
		return err
	}
	size, err := intParam(q, "size", 50, 1, 200)
	if err != nil {
		return err
	}
	query := a.db.Team.Query()
	if term := strings.TrimSpace(q.Get("q")); term != "" {
		query.Where(team.Or(team.NameContainsFold(term), team.IDEQ(term), team.HasMembershipsWith(membership.HasUserWith(user.EmailContainsFold(term)))))
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		return err
	}
	rows, err := query.Order(ent.Desc(team.FieldCreatedAt), ent.Desc(team.FieldID)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		return err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, map[string]any{"id": row.ID, "name": row.Name, "createdAt": row.CreatedAt})
	}
	writeJSON(w, 200, map[string]any{"teams": out, "total": total, "page": page, "totalPages": max(1, (total+size-1)/size)})
	return nil
}
func getTeam(a *api, w http.ResponseWriter, r *http.Request, _ actor) error {
	row, err := a.db.Team.Get(r.Context(), r.PathValue("id"))
	if ent.IsNotFound(err) {
		return &apiError{status: 404, code: "team_not_found"}
	}
	if err != nil {
		return err
	}
	page, err := intParam(r.URL.Query(), "page", 1, 1, 1<<30)
	if err != nil {
		return err
	}
	query := a.db.Membership.Query().Where(membership.TeamID(row.ID))
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		return err
	}
	members, err := query.Order(ent.Asc(membership.FieldCreatedAt), ent.Asc(membership.FieldID)).WithUser().Offset((page - 1) * 50).Limit(50).All(r.Context())
	if err != nil {
		return err
	}
	out := make([]map[string]any, 0, len(members))
	for _, m := range members {
		u := m.Edges.User
		out = append(out, map[string]any{"id": m.UserID, "email": u.Email, "name": u.Name, "role": m.Role})
	}
	writeJSON(w, 200, map[string]any{"id": row.ID, "name": row.Name, "createdAt": row.CreatedAt, "members": out, "total": total, "page": page, "totalPages": max(1, (total+49)/50)})
	return nil
}
func getSystem(a *api, w http.ResponseWriter, _ *http.Request, _ actor) error {
	configured := func(key string) bool { return strings.TrimSpace(a.host.Env(key)) != "" }
	writeJSON(w, 200, map[string]any{"serviceRole": a.host.ServiceRole, "database": a.host.Dialect, "google": configured("AUTH_GOOGLE_ID") && configured("AUTH_GOOGLE_SECRET"), "email": configured("SMTP_URL"), "automation": configured("MANAGE_API_KEY"), "privateProviders": strings.TrimSpace(a.host.Env("ALLOW_PRIVATE_PROVIDERS")) == "true"})
	return nil
}
