package web

// Which AI crawlers may read this site. The siblings keep the same list and
// rule in their own `ai-crawlers.ts`, seed's being the source: keep this one in
// step with it.
//
// **Crawlers that gather training data are refused; crawlers that fetch a page
// to answer a question are not.** Search and assistant fetchers (OAI-SearchBot,
// ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User,
// Googlebot, bingbot) are deliberately not listed: a bot with no group of its
// own falls under `*`, so it follows the same disallow list as everybody else
// and can cite us. Listing them would only create a second group whose disallow
// list has to be kept in step by hand.
//
// `Google-Extended` and `Applebot-Extended` are opt-out tokens, not crawlers:
// refusing them does not touch Google Search or Apple's search results.
//
// `allow` lists the paths a refused bot may still read. A longer match wins, so
// `Allow: /llms.txt` beats `Disallow: /`. It is where a site whose documents
// are meant for agents keeps them readable.
//
// robots.txt is a request, not a wall: it binds only crawlers that honour it.

// AITrainingBots are the crawlers refused the whole site.
var AITrainingBots = []string{
	"GPTBot",
	"ClaudeBot",
	"anthropic-ai",
	"Google-Extended",
	"Applebot-Extended",
	"CCBot",
	"Bytespider",
	"meta-externalagent",
	"cohere-ai",
}

// RobotsGroup is one group of robots.txt: who it names, and what they may read.
type RobotsGroup struct {
	UserAgents []string
	Allow      []string
	Disallow   []string
}

// AITrainingRule is the group that refuses the training crawlers everything
// but /llms.txt and the paths given.
func AITrainingRule(allow ...string) RobotsGroup {
	return RobotsGroup{
		UserAgents: AITrainingBots,
		Allow:      append([]string{"/llms.txt"}, allow...),
		Disallow:   []string{"/"},
	}
}
