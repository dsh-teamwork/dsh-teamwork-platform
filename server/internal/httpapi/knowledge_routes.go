package httpapi

import (
	"net/http"
	"strconv"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/knowledge"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/wire"
)

// knowledgeCaller is who a knowledge route answers: a member, and whether it
// is their plugin or computer, whose every change is a proposal
// (docs/tech/knowledge.md, "Rules").
func knowledgeCaller(c *caller) knowledge.Caller {
	return knowledge.Caller{UserID: c.user.ID, TeamID: c.team, Agent: c.bearer}
}

// decodeText reads a JSON body that carries a document's text, which may be
// larger than any other body the API takes.
func decodeText(r *http.Request, v any) error {
	b, err := readBody(r, knowledge.MaxText+maxBody)
	if err != nil {
		if e, ok := err.(*wire.Error); ok && e.Status == http.StatusRequestEntityTooLarge {
			return wire.E(http.StatusRequestEntityTooLarge, "knowledge_too_large")
		}
		return err
	}
	return wire.Decode(b, v, false)
}

// knowledgeRoute answers with what run returns, never stored by a cache.
func knowledgeRoute(who func(*Server, *http.Request) (*caller, error), status int, run func(*http.Request, knowledge.Caller) (any, error)) func(*Server) handler {
	return func(s *Server) handler {
		return func(w http.ResponseWriter, r *http.Request) error {
			c, err := who(s, r)
			if err != nil {
				return err
			}
			out, err := run(r, knowledgeCaller(c))
			if err != nil {
				return err
			}
			noStore(w)
			if out == nil {
				w.WriteHeader(http.StatusNoContent)
				return nil
			}
			writeJSON(w, status, out)
			return nil
		}
	}
}

func user(s *Server, r *http.Request) (*caller, error)   { return s.requireUser(r) }
func plugin(s *Server, r *http.Request) (*caller, error) { return s.requirePlugin(r) }

// knowledgeRoutes registers every knowledge route on the server's mux
// helpers; get and write are Server.Handler's.
func (s *Server) knowledgeRoutes(get, post func(string, handler), write func(string, string, handler)) {
	k := s.Knowledge
	team := func(r *http.Request) string { return r.PathValue("teamId") }
	id := func(r *http.Request) string { return r.PathValue("id") }

	get("/api/knowledge", knowledgeRoute(plugin, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		return k.Manifest(r.Context(), c)
	})(s))
	get("/api/teams/{teamId}/knowledge", knowledgeRoute(plugin, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		return k.Tree(r.Context(), c, team(r))
	})(s))

	post("/api/teams/{teamId}/knowledge/spaces", knowledgeRoute(user, 201, func(r *http.Request, c knowledge.Caller) (any, error) {
		var in struct {
			Name string `json:"name"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return k.CreateSpace(r.Context(), c, team(r), in.Name)
	})(s))
	write("PATCH", "/api/teams/{teamId}/knowledge/spaces/{id}", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		var in struct {
			Name string `json:"name"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return nil, k.RenameSpace(r.Context(), c, team(r), id(r), in.Name)
	})(s))
	write("DELETE", "/api/teams/{teamId}/knowledge/spaces/{id}", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		return nil, k.DeleteSpace(r.Context(), c, team(r), id(r))
	})(s))
	get("/api/teams/{teamId}/knowledge/spaces/{id}/access", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		return k.GetAccess(r.Context(), c, team(r), id(r))
	})(s))
	write("PUT", "/api/teams/{teamId}/knowledge/spaces/{id}/access", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		var in knowledge.Access
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return k.SetAccess(r.Context(), c, team(r), id(r), in)
	})(s))

	post("/api/teams/{teamId}/knowledge/folders", knowledgeRoute(user, 201, func(r *http.Request, c knowledge.Caller) (any, error) {
		var in knowledge.FolderInput
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return k.CreateFolder(r.Context(), c, team(r), in)
	})(s))
	write("PATCH", "/api/teams/{teamId}/knowledge/folders/{id}", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		var in struct {
			Name string `json:"name"`
		}
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return nil, k.RenameFolder(r.Context(), c, team(r), id(r), in.Name)
	})(s))
	write("DELETE", "/api/teams/{teamId}/knowledge/folders/{id}", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		return nil, k.DeleteFolder(r.Context(), c, team(r), id(r))
	})(s))

	post("/api/teams/{teamId}/knowledge/documents", knowledgeRoute(user, 201, func(r *http.Request, c knowledge.Caller) (any, error) {
		var in knowledge.DocumentInput
		if err := decodeText(r, &in); err != nil {
			return nil, err
		}
		return k.CreateDocument(r.Context(), c, team(r), in)
	})(s))
	get("/api/teams/{teamId}/knowledge/documents/{id}", knowledgeRoute(plugin, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		n := 0
		if v := r.URL.Query().Get("version"); v != "" {
			var err error
			if n, err = strconv.Atoi(v); err != nil || n < 1 {
				return nil, wire.E(http.StatusNotFound, "knowledge_not_found")
			}
		}
		return k.Get(r.Context(), c, team(r), id(r), n)
	})(s))
	write("PATCH", "/api/teams/{teamId}/knowledge/documents/{id}", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		var in knowledge.DocumentPatch
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return k.Patch(r.Context(), c, team(r), id(r), in)
	})(s))
	write("DELETE", "/api/teams/{teamId}/knowledge/documents/{id}", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		return nil, k.Delete(r.Context(), c, team(r), id(r))
	})(s))
	post("/api/teams/{teamId}/knowledge/documents/{id}/versions", knowledgeRoute(user, 201, func(r *http.Request, c knowledge.Caller) (any, error) {
		var in knowledge.VersionInput
		if err := decodeText(r, &in); err != nil {
			return nil, err
		}
		return k.AddVersion(r.Context(), c, team(r), id(r), in)
	})(s))
	post("/api/teams/{teamId}/knowledge/documents/{id}/versions/{n}/restore", knowledgeRoute(user, 201, func(r *http.Request, c knowledge.Caller) (any, error) {
		n, err := strconv.Atoi(r.PathValue("n"))
		if err != nil || n < 1 {
			return nil, wire.E(http.StatusNotFound, "knowledge_not_found")
		}
		return k.Restore(r.Context(), c, team(r), id(r), n)
	})(s))
	post("/api/teams/{teamId}/knowledge/documents/{id}/proposals", knowledgeRoute(plugin, 201, func(r *http.Request, c knowledge.Caller) (any, error) {
		var in knowledge.ProposalInput
		if err := decodeText(r, &in); err != nil {
			return nil, err
		}
		return k.Propose(r.Context(), c, team(r), id(r), in)
	})(s))

	get("/api/teams/{teamId}/knowledge/proposals", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		return k.Proposals(r.Context(), c, team(r), r.URL.Query().Get("state"))
	})(s))
	get("/api/teams/{teamId}/knowledge/proposals/{id}", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		return k.GetProposal(r.Context(), c, team(r), id(r))
	})(s))
	post("/api/teams/{teamId}/knowledge/proposals/{id}/accept", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		return k.Accept(r.Context(), c, team(r), id(r))
	})(s))
	post("/api/teams/{teamId}/knowledge/proposals/{id}/decline", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		var in knowledge.Decision
		if err := decode(r, &in); err != nil {
			return nil, err
		}
		return k.Decline(r.Context(), c, team(r), id(r), in)
	})(s))
	post("/api/teams/{teamId}/knowledge/proposals/{id}/withdraw", knowledgeRoute(user, 200, func(r *http.Request, c knowledge.Caller) (any, error) {
		return k.Withdraw(r.Context(), c, team(r), id(r))
	})(s))
}
