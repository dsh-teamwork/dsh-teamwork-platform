/**
 * The browser filter is the only thing between a URL or a page title and
 * PostHog, and both can carry what somebody typed: a search, a sentence handed
 * through a sign-in redirect, the name given to a thing. Pinned here so a
 * config change cannot quietly start sending them.
 */

import type { CaptureResult } from 'posthog-js';
import { describe, expect, it } from 'vitest';

import { scrubEvent, withoutQuery } from '../analytics';

function pageview(properties: Record<string, unknown>): CaptureResult {
  return { uuid: 'u', event: '$pageview', properties } as CaptureResult;
}

describe('the browser analytics filter', () => {
  it('cuts the query and the fragment off every URL', () => {
    const event = scrubEvent(
      pageview({
        $current_url: 'https://example.com/sign-in?next=%2F%3Fq%3Dmy+diary#code',
        $referrer: 'https://www.google.com/search?q=something+personal',
        $initial_current_url: 'https://example.com/a?b=c',
        $initial_referrer: '$direct',
      }),
    );
    expect(event?.properties).toEqual({
      $current_url: 'https://example.com/sign-in',
      $referrer: 'https://www.google.com/search',
      $initial_current_url: 'https://example.com/a',
      $initial_referrer: '$direct',
    });
  });

  it('drops the page title', () => {
    expect(scrubEvent(pageview({ title: 'Letter to Mum', $pathname: '/d/abc' }))?.properties).toEqual({ $pathname: '/d/abc' });
  });

  it('drops a URL it cannot parse rather than sending it whole', () => {
    expect(withoutQuery('not a url?q=secret')).toBeUndefined();
    expect(scrubEvent(pageview({ $current_url: 'not a url?q=secret' }))?.properties).toEqual({});
  });
});
