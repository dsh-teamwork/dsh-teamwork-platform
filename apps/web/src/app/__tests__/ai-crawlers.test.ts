import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import robots from '../robots';
import { AI_TRAINING_BOTS } from '@/lib/ai-crawlers';

beforeEach(() => vi.stubEnv('APP_URL', 'https://example.com'));
afterEach(() => vi.unstubAllEnvs());

const groups = () => [robots().rules].flat().map((r) => ({ ...r, agents: [r.userAgent].flat() }));

describe('AI crawler policy', () => {
  it('refuses every training crawler the whole site, except what the site keeps open for agents', () => {
    const group = groups().find((g) => g.agents.includes('GPTBot'))!;
    expect(group.agents).toEqual(AI_TRAINING_BOTS);
    expect(group.disallow).toBe('/');
    expect(group.allow).toEqual(expect.arrayContaining(['/llms.txt']));
  });

  it('leaves search and assistant fetchers under the * group', () => {
    const named = groups().flatMap((g) => g.agents);
    for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Googlebot', 'bingbot'])
      expect(named).not.toContain(bot);
  });

  it('keeps the * group first and open', () => {
    const first = groups()[0]!;
    expect(first.agents).toEqual(['*']);
    expect(first.allow).toBe('/');
  });
});
