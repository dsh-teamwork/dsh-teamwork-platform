'use client';

/**
 * The browser's half of analytics: anonymous pageviews, and nothing else.
 *
 * Cookieless (`cookieless_mode: 'always'`): nothing is written to the visitor's
 * browser, so there is no consent banner to show, and PostHog counts unique
 * visitors from a daily-salted hash on its side — which the project must have
 * switched on (docs/ops/analytics.md §2). The price is that a browser is never
 * identified: who a visitor is, and what they did with their account, is the
 * server's to report (`captureServerEvent`). Autocapture, session recording and
 * surveys stay off, since each would read what is on the page.
 *
 * **Every URL leaves without its query and fragment, and no page title leaves
 * at all.** Both can carry what somebody typed — a search, a sentence handed
 * through a sign-in redirect, the name somebody gave a thing. A path holds
 * only routes and the ids of our own rows. `scrubEvent` is the filter.
 *
 * Off without `NEXT_PUBLIC_POSTHOG_KEY`.
 */

import posthog, { type CaptureResult } from 'posthog-js';
import { useEffect } from 'react';

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

const URL_PROPERTIES = ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer'];
const DROPPED_PROPERTIES = ['title', '$title'];

/** A URL without its query and fragment; `$direct` stays, anything unparsable is dropped. */
export function withoutQuery(value: unknown): string | undefined {
  if (value === '$direct') return value;
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  for (const name of DROPPED_PROPERTIES) delete event.properties[name];
  for (const name of URL_PROPERTIES) {
    if (!(name in event.properties)) continue;
    const cleaned = withoutQuery(event.properties[name]);
    if (cleaned === undefined) delete event.properties[name];
    else event.properties[name] = cleaned;
  }
  return event;
}

export function Analytics() {
  useEffect(() => {
    if (!key || posthog.__loaded) return;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      defaults: '2026-08-30',
      cookieless_mode: 'always',
      person_profiles: 'never',
      capture_pageview: 'history_change',
      autocapture: false,
      disable_session_recording: true,
      disable_surveys: true,
      before_send: scrubEvent,
    });
  }, []);
  return null;
}
