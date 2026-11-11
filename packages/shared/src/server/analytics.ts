/**
 * Server-side analytics: what the server sees happen to an account, captured
 * under the account's `User.id` so PostHog can follow one person across the web
 * and the phone. The browser only counts anonymously (cookieless), so this is
 * the one place an event is tied to somebody.
 *
 * Off without `NEXT_PUBLIC_POSTHOG_KEY` — the same project key the browser
 * uses, since both sides land in one project. Capturing never throws and never
 * waits: an analytics outage must not fail the request that caused the event.
 * A malformed event is not sent, and is logged rather than dropped silently.
 */

import 'server-only';

import { PostHog } from 'posthog-node';

import { ANALYTICS_EVENTS, type AnalyticsClient, type AnalyticsEvent, type AnalyticsProperties } from '../analytics';
import { bearerFromHeader } from '../auth';

let client: PostHog | null | undefined;

function posthog(): PostHog | null {
  if (client === undefined) {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
    // flushAt 1: each event leaves at once, so a deploy that stops this
    // process loses nothing still sitting in a batch.
    client = key
      ? new PostHog(key, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com', flushAt: 1, flushInterval: 0 })
      : null;
  }
  return client;
}

/** A Bearer token is the phone; anything else — a cookie, a server component — is the browser. */
export function analyticsClient(request?: Request): AnalyticsClient {
  return request && bearerFromHeader(request.headers.get('authorization')) ? 'plugin' : 'web';
}

export function captureServerEvent<E extends AnalyticsEvent>(
  userId: string,
  event: E,
  properties: AnalyticsProperties<E>,
): void {
  const ph = posthog();
  if (!ph) return;
  const parsed = ANALYTICS_EVENTS[event].properties.safeParse(properties);
  if (!parsed.success) {
    console.error(`[analytics] ${event} not sent: its properties do not match ANALYTICS_EVENTS`, parsed.error.issues);
    return;
  }
  try {
    ph.capture({ distinctId: userId, event, properties: parsed.data, disableGeoip: true });
  } catch (error) {
    console.error(`[analytics] ${event} not sent`, error);
  }
}
