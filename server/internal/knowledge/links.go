package knowledge

import (
	"context"
	"regexp"
	"sort"
	"strings"

	"entgo.io/ent/dialect/sql"

	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgedocument"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/knowledgeversion"
	"github.com/dsh-teamwork/dsh-teamwork-platform/server/internal/db/ent/predicate"
)

// Backlink is a document whose current text links to another
// (docs/tech/knowledge.md, "Format": backlinks).
type Backlink struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	SpaceID string `json:"spaceId"`
}

// wikiLink is a `[[…]]` link as Obsidian writes it: no brackets or line
// break inside. The console's lib/knowledge-format.ts holds the same rule.
var wikiLink = regexp.MustCompile(`\[\[([^\[\]\n]+)\]\]`)

// fence opens or closes a fenced code block, whose text links nothing.
var fence = regexp.MustCompile("^ {0,3}(```|~~~)")

// inlineCode is a code span, whose text links nothing either.
var inlineCode = regexp.MustCompile("`[^`\n]*`")

// linkedTitles is the document titles a text links to, `[[Title]]`,
// `[[Title#Heading]]` or `[[Title|shown]]`, outside code; a link naming an
// attachment (by its extension), an artifact or a heading of the text itself
// is left out.
func linkedTitles(text string) []string {
	var out []string
	inFence := false
	for _, line := range strings.Split(text, "\n") {
		if fence.MatchString(line) {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}
		for _, m := range wikiLink.FindAllStringSubmatch(inlineCode.ReplaceAllString(line, ""), -1) {
			target := m[1]
			if bar := strings.IndexByte(target, '|'); bar >= 0 {
				target = target[:bar]
			}
			if hash := strings.IndexByte(target, '#'); hash >= 0 {
				target = target[:hash]
			}
			title := strings.TrimSpace(target)
			if title != "" && !namesAttachment(title) && !strings.HasPrefix(title, ArtifactEmbed) {
				out = append(out, title)
			}
		}
	}
	return out
}

// namesAttachment says whether a link's target names an attachment: an
// extension attachmentTypes allows, after a dot that is not the first
// character, as the console tells them apart.
func namesAttachment(title string) bool {
	dot := strings.LastIndexByte(title, '.')
	if dot <= 0 {
		return false
	}
	_, ok := attachmentTypes[strings.ToLower(title[dot:])]
	return ok
}

// resolve is the document a link titled title, written in fromSpace, opens,
// over the documents a reader sees in tree order: an exact title first, then
// one that differs only in case, and among several, the one in fromSpace.
// lib/knowledge-tree.ts resolves a link the same way.
func resolve(tree Tree, title, fromSpace string) string {
	lower := strings.ToLower(title)
	for _, same := range []func(string) bool{
		func(t string) bool { return t == title },
		func(t string) bool { return strings.ToLower(t) == lower },
	} {
		first := ""
		for _, sp := range tree.Spaces {
			for _, d := range sp.Documents {
				if !same(d.Title) {
					continue
				}
				if sp.ID == fromSpace {
					return d.ID
				}
				if first == "" {
					first = d.ID
				}
			}
		}
		if first != "" {
			return first
		}
	}
	return ""
}

// backlinks is every document of tree, other than documentID, whose current
// text holds a link that opens documentID, by title.
func (s *Service) backlinks(ctx context.Context, tree Tree, documentID, title string) ([]Backlink, error) {
	spaces := map[string]bool{}
	ids := []any{}
	for _, sp := range tree.Spaces {
		spaces[sp.ID] = true
		ids = append(ids, sp.ID)
	}
	out := []Backlink{}
	if len(ids) == 0 {
		return out, nil
	}
	// Only the current version of each document of a space the reader sees,
	// and only one that mentions the title at all; which mention is a link
	// that opens this document is decided below.
	rows, err := s.DB.KnowledgeVersion.Query().
		Where(currentIn(ids), knowledgeversion.DocumentIDNEQ(documentID), knowledgeversion.TextContainsFold(title)).
		Select(knowledgeversion.FieldDocumentID, knowledgeversion.FieldText).All(ctx)
	if err != nil {
		return nil, err
	}
	where := map[string]DocumentSummary{}
	spaceOf := map[string]string{}
	for _, sp := range tree.Spaces {
		for _, d := range sp.Documents {
			where[d.ID] = d
			spaceOf[d.ID] = sp.ID
		}
	}
	for _, r := range rows {
		from, ok := where[r.DocumentID]
		if !ok || !spaces[spaceOf[r.DocumentID]] {
			continue
		}
		for _, t := range linkedTitles(r.Text) {
			if resolve(tree, t, spaceOf[r.DocumentID]) == documentID {
				out = append(out, Backlink{ID: from.ID, Title: from.Title, SpaceID: spaceOf[r.DocumentID]})
				break
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Title != out[j].Title {
			return out[i].Title < out[j].Title
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// currentIn keeps the current version of each document in the spaces ids.
func currentIn(ids []any) predicate.KnowledgeVersion {
	return predicate.KnowledgeVersion(func(sel *sql.Selector) {
		d := sql.Table(knowledgedocument.Table)
		sel.Join(d).On(sel.C(knowledgeversion.FieldDocumentID), d.C(knowledgedocument.FieldID))
		sel.Where(sql.And(
			sql.ColumnsEQ(sel.C(knowledgeversion.FieldNumber), d.C(knowledgedocument.FieldCurrentVersion)),
			sql.In(d.C(knowledgedocument.FieldSpaceID), ids...),
		))
	})
}

// ArtifactEmbed opens the target of a link that embeds an artifact,
// `![[artifact:{id}]]`, which links no document.
const ArtifactEmbed = "artifact:"
