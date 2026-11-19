# 0054. A funded route states its own bounds

> **Status:** Accepted · **Date:** 2026-11-19

## Context

A funded model (ADR 0024) was held to the one bound adapter the gateway knew:
direct DeepSeek, a 1M-token input and up to 393,216 output tokens, checked by
the upstream's address and model name. An edition could therefore fund
DeepSeek and nothing else: a model behind any other address, an aggregator
such as OpenRouter included, was refused `budget_bound_unavailable` before it
reached the upstream. An aggregator also needs a field of its own in the
request (OpenRouter's `provider` routing object) that no caller may set, and
it reports a price of its own for each call (`usage.cost`), which an edition
needs to know what the call actually cost it.

## Decision

- **The quote carries the route's bounds.** `edition.FundingQuote` adds
  `MaxInput` and `MaxOutput`, which size the hold as DeepSeek's documented
  limits did; the request checks that adapter made (text and function calls
  only, no unknown billable field, output at most the bound, 8,192 when none is
  asked) are kept for every route (`usage.RouteBounds`). A BYOK budget still
  has only the DeepSeek adapter.
- **The quote may add fields to the upstream body** (`Body`), merged after the
  caller's fields are checked and priced. It may not name `model` or any field
  the gateway forwards (`usage.ChatFields`), so it can route a call but cannot
  change what was priced.
- **Settlement passes the upstream's own price** (`FundingSettlement.UpstreamCost`):
  the observer reads `usage.cost` verbatim, as it reads the tokens, and the
  edition decides what it means. It also reads OpenRouter's cache writes
  (`prompt_tokens_details.cache_write_tokens`), which were counted as uncached
  input. The price is never a reason to accept the tokens, and a second,
  different one invalidates the observation like a second total does.
- **`edition.Host` seals an extension's secrets** (`Seal`, `Unseal`) under
  `PROVIDER_KEYS_SECRET`, bound to the extension's name and the name it gives,
  so a supplier key an operator enters can be stored like a team's provider key.

## Consequences

- An edition can fund any OpenAI-compatible route whose limits it states; the
  bounds are its claim, and a call that exceeds them is still settled as an
  overrun and suspends the route (ADR 0024).
- Community code still parses every response once; an edition receives the
  cost as a fact and never the response.
- Rejected: an adapter per aggregator in community code, which would put a
  hosted supplier's contract in the open tree; and letting a caller pass
  routing fields, which would let a member choose a dearer upstream than the
  one priced.
