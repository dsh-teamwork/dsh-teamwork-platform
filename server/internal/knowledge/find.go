package knowledge

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgedocument"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeversion"
)

// Found is a document a search, or a mention, finds: where it is, and the
// line it was found on with the heading above that line.
type Found struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	SpaceID    string `json:"spaceId"`
	Version    int    `json:"version"`
	TitleMatch bool   `json:"titleMatch"`
	Heading    string `json:"heading"`
	Snippet    string `json:"snippet"`
	UpdatedAt  string `json:"updatedAt"`
}

// maxFound is the most documents one search answers with.
const maxFound = 30

// Search finds the documents the caller reads whose title or current text
// holds q, ignoring case, for a person in the console
// (docs/tech/knowledge.md, "Search"). A title match ranks first, then the
// documents that hold q most often. It reads every matching text as it is,
// with no index, which serves a team up to a few thousand documents; agents
// search their synced copy instead.
func (s *Service) Search(ctx context.Context, c Caller, teamID, q string) ([]Found, error) {
	q = strings.TrimSpace(q)
	if q == "" || utf8.RuneCountInString(q) > 100 {
		return nil, invalid("A query of 1 to 100 characters", "q")
	}
	tree, err := s.Tree(ctx, c, teamID)
	if err != nil {
		return nil, err
	}
	ids, docs := treeDocuments(tree)
	out := []Found{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.DB.KnowledgeVersion.Query().Where(currentIn(ids), knowledgeversion.TextContainsFold(q)).
		Select(knowledgeversion.FieldDocumentID, knowledgeversion.FieldText).All(ctx)
	if err != nil {
		return nil, err
	}
	texts := map[string]string{}
	for _, r := range rows {
		texts[r.DocumentID] = r.Text
	}
	needle := fold(q)
	counts := map[string]int{}
	for id, d := range docs {
		f := Found{ID: id, Title: d.summary.Title, SpaceID: d.space, Version: d.summary.CurrentVersion, UpdatedAt: d.summary.UpdatedAt}
		f.TitleMatch = strings.Contains(fold(d.summary.Title), needle)
		if text, ok := texts[id]; ok {
			counts[id], f.Heading, f.Snippet = locate(text, needle)
		}
		if f.TitleMatch || counts[id] > 0 {
			out = append(out, f)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.TitleMatch != b.TitleMatch {
			return a.TitleMatch
		}
		if counts[a.ID] != counts[b.ID] {
			return counts[a.ID] > counts[b.ID]
		}
		return a.Title < b.Title
	})
	if len(out) > maxFound {
		out = out[:maxFound]
	}
	return out, nil
}

// Mentions is every document the caller reads whose current text mentions
// them, `@[Name](their-id)`, the owner property included; newest change
// first, with the line that mentions them.
func (s *Service) Mentions(ctx context.Context, c Caller, teamID string) ([]Found, error) {
	tree, err := s.Tree(ctx, c, teamID)
	if err != nil {
		return nil, err
	}
	ids, docs := treeDocuments(tree)
	out := []Found{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.DB.KnowledgeVersion.Query().Where(currentIn(ids), knowledgeversion.TextContains("]("+c.UserID+")")).
		Select(knowledgeversion.FieldDocumentID, knowledgeversion.FieldText).All(ctx)
	if err != nil {
		return nil, err
	}
	mention := regexp.MustCompile(`@\[[^\]\n]*\]\(` + regexp.QuoteMeta(c.UserID) + `\)`)
	for _, r := range rows {
		d, ok := docs[r.DocumentID]
		if !ok {
			continue
		}
		at := mention.FindStringIndex(r.Text)
		if at == nil {
			continue
		}
		heading, line := around(r.Text, at[0])
		out = append(out, Found{ID: r.DocumentID, Title: d.summary.Title, SpaceID: d.space, Version: d.summary.CurrentVersion, Heading: heading, Snippet: line, UpdatedAt: d.summary.UpdatedAt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out, nil
}

// Row is a document as a folder's table shows it: its place in the tree and
// its front matter as written, which the console reads its properties from.
type Row struct {
	DocumentSummary
	FrontMatter string `json:"frontMatter"`
}

// frontMatter is a text's YAML front matter with its fences, as the console's
// splitFrontMatter reads it.
var frontMatter = regexp.MustCompile(`^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)`)

// Rows is the documents directly in a folder of a space the caller reads,
// or at its root when folderID is empty, with their front matter.
func (s *Service) Rows(ctx context.Context, c Caller, teamID, spaceID, folderID string) ([]Row, error) {
	if _, err := s.space(ctx, c, teamID, spaceID); err != nil {
		return nil, err
	}
	if err := s.inFolder(ctx, spaceID, folderID); err != nil {
		return nil, err
	}
	docs, err := s.DB.KnowledgeDocument.Query().Where(knowledgedocument.SpaceID(spaceID), knowledgedocument.FolderID(folderID)).
		Order(ent.Asc(knowledgedocument.FieldTitle)).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Row, 0, len(docs))
	if len(docs) == 0 {
		return out, nil
	}
	rows, err := s.DB.KnowledgeVersion.Query().Where(currentIn([]any{spaceID}), knowledgeversion.DocumentIDIn(ids(docs)...)).
		Select(knowledgeversion.FieldDocumentID, knowledgeversion.FieldText).All(ctx)
	if err != nil {
		return nil, err
	}
	texts := map[string]string{}
	for _, r := range rows {
		texts[r.DocumentID] = r.Text
	}
	for _, d := range docs {
		out = append(out, Row{DocumentSummary: summary(d), FrontMatter: frontMatter.FindString(texts[d.ID])})
	}
	return out, nil
}

func ids(docs []*ent.KnowledgeDocument) []string {
	out := make([]string, 0, len(docs))
	for _, d := range docs {
		out = append(out, d.ID)
	}
	return out
}

type placed struct {
	summary DocumentSummary
	space   string
}

// treeDocuments is the spaces of a tree, as a query's arguments, and its
// documents by id.
func treeDocuments(tree Tree) ([]any, map[string]placed) {
	var spaces []any
	docs := map[string]placed{}
	for _, sp := range tree.Spaces {
		spaces = append(spaces, sp.ID)
		for _, d := range sp.Documents {
			docs[d.ID] = placed{summary: d, space: sp.ID}
		}
	}
	return spaces, docs
}

// fold is s in lower case, rune by rune, so an index into it is an index
// into s's runes.
func fold(s string) string {
	return strings.Map(unicode.ToLower, s)
}

// locate counts needle in text, ignoring case, and gives the heading above
// its first appearance and the line it is on.
func locate(text, needle string) (int, string, string) {
	lower := []rune(fold(text))
	n := []rune(needle)
	count, first := 0, -1
	for i := 0; i+len(n) <= len(lower); i++ {
		if string(lower[i:i+len(n)]) == needle {
			if first < 0 {
				first = i
			}
			count++
			i += len(n) - 1
		}
	}
	if first < 0 {
		return 0, "", ""
	}
	heading, line := around(text, len(string([]rune(text)[:first])))
	return count, heading, line
}

// around is the heading above byte offset at in text, without its marks,
// and the line at holds, trimmed to at most 160 characters around at.
func around(text string, at int) (string, string) {
	start := strings.LastIndexByte(text[:at], '\n') + 1
	end := strings.IndexByte(text[at:], '\n')
	if end < 0 {
		end = len(text)
	} else {
		end += at
	}
	heading := ""
	for _, l := range strings.Split(text[:start], "\n") {
		if t := strings.TrimLeft(l, " "); strings.HasPrefix(t, "#") {
			heading = strings.TrimSpace(strings.TrimLeft(t, "#"))
		}
	}
	line := []rune(text[start:end])
	pos := utf8.RuneCountInString(text[start:at])
	from, to := 0, len(line)
	if to-from > 160 {
		from = max(0, pos-60)
		to = min(len(line), from+160)
	}
	out := strings.TrimSpace(string(line[from:to]))
	if from > 0 {
		out = "…" + out
	}
	if to < len(line) {
		out += "…"
	}
	return heading, out
}
