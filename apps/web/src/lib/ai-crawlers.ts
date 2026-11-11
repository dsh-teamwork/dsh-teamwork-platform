import type { MetadataRoute } from 'next';

/**
 * Which AI crawlers may read this site, the same in every repository.
 *
 * **Crawlers that gather training data are refused; crawlers that fetch a page
 * to answer a question are not.** Search and assistant fetchers (OAI-SearchBot,
 * ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User,
 * Googlebot, bingbot) are deliberately not listed: a bot with no group of its
 * own falls under `*`, so it follows the same disallow list as everybody else
 * and can cite us. Listing them would only create a second group whose disallow
 * list has to be kept in step by hand.
 *
 * `Google-Extended` and `Applebot-Extended` are opt-out tokens, not crawlers:
 * refusing them does not touch Google Search or Apple's search results.
 *
 * `allow` lists the paths a refused bot may still read. A longer match wins, so
 * `Allow: /llms.txt` beats `Disallow: /`. It is where a site whose documents
 * are meant for agents keeps them readable.
 *
 * robots.txt is a request, not a wall: it binds only crawlers that honour it.
 */
export const AI_TRAINING_BOTS = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'meta-externalagent',
  'cohere-ai',
];

export function aiTrainingRule(allow: string[] = []) {
  return {
    userAgent: AI_TRAINING_BOTS,
    allow: ['/llms.txt', ...allow],
    disallow: '/',
  } satisfies Exclude<MetadataRoute.Robots['rules'], unknown[] | undefined>;
}
