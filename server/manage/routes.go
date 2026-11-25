package manage

// The admin API's contract: every route under /api/admin, the handler that
// serves it, and the JSON Schema of what it takes and returns. The routes
// are registered from this table and `GET /api/admin` renders it, so what
// an automation agent reads cannot name a route that is not there, or miss
// one that is. What does not change with a route (the credential, the error
// shape, the conventions) is docs/tech/system-management.md.

import "net/http"

type schema = map[string]any

type route struct {
	Method       string `json:"method"`
	Path         string `json:"path"`
	Access       string `json:"access"`
	Description  string `json:"description"`
	Query        schema `json:"query,omitempty"`
	Body         schema `json:"body,omitempty"`
	Response     schema `json:"response"`
	handle       handler
	operatorOnly bool
	// open is a route that answers callers the guard would refuse.
	open func(a *api, w http.ResponseWriter, r *http.Request)
}

const (
	read  = "key or session"
	write = "key with x-agent-id, or session"
)

var timestamp = schema{"type": "string", "description": "ISO 8601, UTC"}

func nullable(t string) schema { return schema{"type": []string{t, "null"}} }

func object(required []string, props schema) schema {
	return schema{"type": "object", "properties": props, "required": required, "additionalProperties": false}
}

var routes = []route{
	{
		Method: "GET", Path: "/api/admin/activity", Access: read,
		Description: "Account and team stocks at read time, creations and model activity in a range of UTC dates.",
		Query: object([]string{}, schema{
			"from": schema{"type": "string", "format": "date", "description": "Inclusive UTC date, defaults to to."},
			"to":   schema{"type": "string", "format": "date", "description": "Inclusive UTC date, defaults to today. Window is 1–93 days."},
		}),
		Response: schema{"type": "object"},
		handle:   getActivity,
	},
	{Method: "GET", Path: "/api/admin/teams", Access: read, Description: "Search teams by name, id or member email.", Response: schema{"type": "object"}, handle: listTeams},
	{Method: "GET", Path: "/api/admin/teams/{id}", Access: read, Description: "Team identity and paginated membership, without configuration secrets.", Response: schema{"type": "object"}, handle: getTeam},
	{Method: "GET", Path: "/api/admin/system", Access: read, Description: "Non-secret instance configuration status.", Response: schema{"type": "object"}, handle: getSystem},
	{
		Method: "GET", Path: "/api/admin", Access: read,
		Description: "This index: every route, its access, and the JSON Schema of what it takes and returns.",
		Response:    schema{"type": "object", "properties": schema{"routes": schema{"type": "array"}}},
		handle:      describe,
	},
	{
		Method: "GET", Path: "/api/admin/me", Access: "anyone",
		Description: "Who the console is for: 200 with an admin's address, 401 without an accepted session, 403 for a session that is not an admin.",
		Response:    object([]string{"email"}, schema{"email": schema{"type": "string"}}),
		open:        me,
	},
	{
		Method: "GET", Path: "/api/admin/stats", Access: read,
		Description: "How things stand: accounts, and those created in the last seven days.",
		Response:    object([]string{"users", "newInWeek", "teams"}, schema{"teams": schema{"type": "integer"}, "users": schema{"type": "integer"}, "newInWeek": schema{"type": "integer"}}),
		handle:      getStats,
	},
	{
		Method: "GET", Path: "/api/admin/users", Access: read,
		Description: "Users, newest first, optionally filtered by email or name.",
		Query: object([]string{}, schema{
			"q":    schema{"type": "string", "description": "Case-insensitive substring of email or name; empty means no filter."},
			"page": schema{"type": "integer", "minimum": 1, "default": 1},
			"size": schema{"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
		}),
		Response: object([]string{"users", "total", "page", "totalPages"}, schema{
			"users": schema{"type": "array", "items": object([]string{"id", "email", "name", "locale", "createdAt"}, schema{
				"id": schema{"type": "string"}, "email": schema{"type": "string"},
				"name": nullable("string"), "locale": nullable("string"), "createdAt": timestamp,
			})},
			"total": schema{"type": "integer"}, "page": schema{"type": "integer"}, "totalPages": schema{"type": "integer"},
		}),
		handle: listUsers,
	},
	{
		Method: "PATCH", Path: "/api/admin/users/{id}", Access: write,
		Description: "Correct a user's display name; null clears it.",
		Body:        object([]string{"name"}, schema{"name": schema{"type": []string{"string", "null"}, "minLength": 1, "maxLength": 80}}),
		Response:    object([]string{"id", "name"}, schema{"id": schema{"type": "string"}, "name": nullable("string")}),
		handle:      renameUser,
	},
}

func index(routes []route) any {
	return map[string]any{
		"docs":   "docs/tech/system-management.md in the repository: the credential, the error shape and the conventions every route follows.",
		"access": "MANAGE_API_KEY or an allowlisted Google session reaches ordinary routes. Financial writes marked Google operator session only refuse automation keys. Every write takes JSON; key writes name x-agent-id, and session writes pass the same-origin check.",
		"routes": routes,
	}
}
