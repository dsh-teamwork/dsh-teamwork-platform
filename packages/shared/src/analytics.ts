/**
 * The product-analytics events: every name PostHog receives from this product,
 * what fires it and the properties it carries. Isomorphic, like the rest of this
 * entry, so a client that captures an event of its own reads the same table.
 *
 * Two sides, one project (docs/ops/analytics.md):
 *
 *   - The browser counts anonymously: pageviews, in cookieless mode, with no
 *     identity at all. Nothing here is captured from a browser in seed.
 *   - The server captures what it sees happen to an account, keyed by
 *     `User.id` (`captureServerEvent`, `@dsh-teamwork/shared/server`). That is where
 *     sign-ups, conversions and cross-client journeys come from.
 *
 * The rules each entry follows:
 *   - The name is `object_verb`, snake_case, past tense: `user_signed_up`.
 *   - Properties are a strict Zod object: a key not declared here is refused,
 *     so nothing lands in PostHog by accident.
 *   - No property carries anything a person typed — no names, addresses,
 *     search text or content. Enumerations and counts only.
 *
 * docs/ops/analytics.md lists every event for an agent reading PostHog without
 * the source; a test holds that table to this one in both directions.
 */

import { z } from 'zod';

import type { SignInMethod } from './auth';

/** Which client a request came from: a Bearer token is the DSH plugin, a cookie is the browser. */
export type AnalyticsClient = 'web' | 'plugin';

export interface AnalyticsEventSpec {
  /** One sentence: when it fires, from where. */
  description: string;
  properties: z.ZodObject;
}

const client = z.enum(['web', 'plugin']) satisfies z.ZodType<AnalyticsClient>;

export const ANALYTICS_EVENTS = {
  user_signed_up: {
    description: 'Server: the first authenticated request of an account created the profile row.',
    properties: z.strictObject({
      via: z.enum(['google', 'email']) satisfies z.ZodType<SignInMethod>,
      client,
    }),
  },
  profile_updated: {
    description: 'Server: PATCH /api/profile changed the profile; lists which fields, never their values.',
    properties: z.strictObject({
      fields: z.array(z.enum(['name', 'locale'])).min(1),
      client,
    }),
  },
} as const satisfies Record<string, AnalyticsEventSpec>;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;

export type AnalyticsProperties<E extends AnalyticsEvent> = z.infer<(typeof ANALYTICS_EVENTS)[E]['properties']>;
