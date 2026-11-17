# Analytics

> **Status:** Current · **Updated:** 2026-11-17

What reaches PostHog: anonymous page counts from the browser, and nothing
else. No account, no person and no behaviour is tracked.

## 1. One side, anonymous

| Side | Sends | Identity | Why |
| --- | --- | --- | --- |
| The browser (`apps/web/src/lib/analytics.ts`) | `$pageview` only, every URL cut to its path and no page title | None. Cookieless: unique visitors are a daily-salted hash PostHog computes | Nothing is stored in the visitor's browser, so there is no consent banner |
| The server | Nothing | — | What an account does is not tracked |

There are no page leaves, no autocapture, no session recording, no surveys and
no identified events. The server sends nothing to PostHog: it only hands the
key to the pages it serves.

The database is the authority for every outcome. Sign-ups, active teams and
other account counts come from the admin API (`premium/docs/ops/manage-api.md`)
or the instance's own management pages, never from PostHog.

The closed edition's operator console and mobile app send nothing.

## 2. Setting up a project

1. Create one PostHog project for the product.
2. In Project settings → Web analytics, switch on **Cookieless server hash
   mode**. Without it PostHog drops every browser event.
3. Put the project's `phc_` key in the server's environment as
   `POSTHOG_KEY` (and `POSTHOG_HOST` for another region than the default). The
   server reads it at run time and writes it into the pages it serves, so the
   browser side needs no build. Leave it unset in development to send nothing.
4. An agent that reads PostHog does so through PostHog's MCP server or
   connector, which whoever runs the agent installs and signs in to with
   access to this project. No PostHog key goes in `docs/ops/`.

## 3. What a page view carries

PostHog's own `$pageview` is the one event. It leaves without a URL's query or
fragment and without the page title (`scrubEvent`), since either can hold a
search or a name somebody gave a thing. So `utm_*` tags on a landing URL are
not in PostHog either.

## 4. Querying

Query through PostHog's MCP server or connector, never with a key from this
repository. It runs HogQL over the `events` table:

```sql
SELECT toDate(timestamp) AS day, count(), count(DISTINCT distinct_id)
FROM events
WHERE event = '$pageview' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day
```

- The hash behind `distinct_id` changes daily, so a week's sum of daily
  visitors overcounts returning ones.
- A query only reads. The connector can do more than query; an agent changes
  nothing in the project that the task did not name.

## 5. Adding an event

Do not, without a decision recorded here first. Tracking what a person or an
account does is a non-goal; a question PostHog's page counts cannot answer is
answered from the database.
