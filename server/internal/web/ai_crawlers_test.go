package web

import (
	"slices"
	"testing"
)

// The siblings' ai-crawlers test, in Go.
func TestAICrawlerPolicy(t *testing.T) {
	groups := robotsGroups()

	t.Run("refuses every training crawler the whole site, except what the site keeps open for agents", func(t *testing.T) {
		i := slices.IndexFunc(groups, func(g RobotsGroup) bool { return slices.Contains(g.UserAgents, "GPTBot") })
		if i < 0 {
			t.Fatal("no group names GPTBot")
		}
		g := groups[i]
		if !slices.Equal(g.UserAgents, AITrainingBots) || !slices.Equal(g.Disallow, []string{"/"}) || !slices.Contains(g.Allow, "/llms.txt") {
			t.Fatalf("%+v", g)
		}
	})

	t.Run("leaves search and assistant fetchers under the * group", func(t *testing.T) {
		for _, bot := range []string{"OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Googlebot", "bingbot"} {
			for _, g := range groups {
				if slices.Contains(g.UserAgents, bot) {
					t.Fatalf("%s is named", bot)
				}
			}
		}
	})

	t.Run("keeps the * group first and open", func(t *testing.T) {
		if first := groups[0]; !slices.Equal(first.UserAgents, []string{"*"}) || !slices.Equal(first.Allow, []string{"/"}) {
			t.Fatalf("%+v", first)
		}
	})
}
