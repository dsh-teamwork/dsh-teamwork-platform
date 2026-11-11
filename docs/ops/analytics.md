# Analytics

> **Status:** Current · **Updated:** 2026-11-11

What reaches PostHog, from where, under which identity, and how to query it
without the source.

## 1. Two sides, one project

Every event lands in one PostHog project per product, from two places:

| Side | Sends | Identity | Why |
| --- | --- | --- | --- |
| The browser (`apps/web/src/components/analytics.tsx`) | `$pageview` and `$pageleave` only, every URL cut to its path and no page title | None. Cookieless: unique visitors are a daily-salted hash PostHog computes | Nothing is stored in the visitor's browser, so there is no consent banner |
| The server (`captureServerEvent`, `@dsh-teamwork/shared/server`) | The events in §3 | `distinct_id` is `User.id` | Only the server knows which account did something, on web and phone alike |

So a funnel from a landing page to a sign-up cannot be joined per person: the
page side is anonymous by design. Traffic questions are answered from the
browser side, and account questions from the server side.

The database stays the authority for outcomes. When PostHog and the admin API
(`premium/docs/ops/manage-api.md`) disagree about a count, the admin API is right, and
the gap is lost or blocked events.

`premium/apps/manage` sends nothing: its users are operators. It authorizes the
identity against `ADMIN_EMAILS` without creating a profile row, so signing in
to the console is never a sign-up and never uses up the one a later first
visit to `apps/web` reports.

## 2. Setting up a project

1. Create one PostHog project for the product. A repository that ships two
   products to one account system may share one project and tell them apart
   with a `product` property on every event.
2. In Project settings → Web analytics, switch on **Cookieless server hash
   mode**. Without it PostHog drops every browser event.
3. Put the project's `phc_` key in `apps/web`'s environment as
   `NEXT_PUBLIC_POSTHOG_KEY`, on Railway and locally. The browser and the server
   both read it. Leave it unset in development to send nothing.
4. An agent that reads PostHog does so through PostHog's MCP server or
   connector, which whoever runs the agent installs and signs in to with
   access to this project. No PostHog key goes in `docs/ops/`.

## 3. Events

Besides PostHog's own `$pageview` and `$pageleave` from the browser, these are
every event this product sends. The names and properties are
`ANALYTICS_EVENTS` in `packages/shared/src/analytics.ts`, and
`packages/shared/src/__tests__/analytics.test.ts` fails when this table and that
list disagree.

| Event | Source | Fires when | Properties |
| --- | --- | --- | --- |
| `user_signed_up` | server | The first authenticated request of a new account to `apps/web` creates its profile row; exactly once per account | `via` (`google`, `email`, `password`), `client` (`web`, `plugin`) |
| `profile_updated` | server | `PATCH /api/profile` changes the profile | `fields` (any of `name`, `locale`; never their values), `client` |

No property carries anything a person typed. Server events have GeoIP turned
off, because the only address the server sees is its own. Browser events leave
without a URL's query or fragment and without the page title, since either can
hold a search or a name somebody gave a thing. So `utm_*` tags on a landing URL
are not in PostHog either; attribution a product needs is recorded server-side
and sent as a property of the server event.

## 4. Querying

Query through PostHog's MCP server or connector, never with a key from this
repository. It runs HogQL, PostHog's SQL dialect, over the `events` table:

```sql
SELECT toDate(timestamp) AS day, count()
FROM events
WHERE event = 'user_signed_up' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day
```

- A server event's `distinct_id` is the `User.id` the admin API returns, so a
  person found in one is the same person in the other.
- Anonymous visitors: `SELECT count(DISTINCT distinct_id) FROM events WHERE event = '$pageview'`
  counts per day. The hash changes daily, so a week's sum overcounts returning
  visitors.
- A query only reads. The connector can do more than query; an agent changes
  nothing in the project that the task did not name.

## 5. Adding an event

This section is for whoever changes the code, not for the agent.

1. Add the entry to `ANALYTICS_EVENTS`: an `object_verb` past-tense name and a
   strict properties schema holding enumerations and counts only.
2. Call `captureServerEvent(user.id, name, properties)` where the server sees
   it happen. Properties that fail the schema are not sent, and the failure is
   logged.
3. Add its row to §3 in the same commit.

An event only a client can see (a screen shown, a paywall dismissed) is the
exception. It needs a client SDK with its own identity rules, and is a decision
to record here first.
