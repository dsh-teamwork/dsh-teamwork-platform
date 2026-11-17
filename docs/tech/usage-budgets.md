# Usage points and team budgets

> **Status:** Current — community metering, budgets, optional atomic model funding and edition meters · **Updated:** 2026-11-17

Community instances measure model usage and enforce team/member/provider
reference budgets without a hosted account, payment service or subscription
([ADR 0021](../adr/0021-community-usage-and-budgets.md)). This document describes
the implementation and its current provider limits.

## Ownership and prices

Optional model funding uses the public transaction described in
[ADR 0024](../adr/0024-atomic-model-funding.md). `edition.Host` registers a
named participant, lends a lifetime-bound SQL executor, and publishes protected
model configurations. Its immutable quote supplies the public request price;
team admins can read that rate but cannot replace it with a BYOK reference rate.
An absent participant refuses the owned route. BYOK never falls back to funded
capacity. Funding owners implement their own monetary records and do not parse
provider responses independently. Operator-only recovery records estimates and
settles both resource sets together; the team API remains limited to BYOK.

`server/internal/usage` owns normalization, immutable model rates, usage rows,
policy/window reservations, settlement, recovery and notification work. The
existing authenticated team API and console expose it on SQLite, Postgres and
MySQL. Nothing installs a cap automatically. Admins configure reference rates
in Models, then daily/monthly caps in Budgets; Usage shows the resulting calls.

The scale is `1 CNY = 1,000 reference points` and `1 point = 1,000,000,000`
integer accounting units ([ADR 0022](../adr/0022-reference-usage-accounting.md)).
CNY-per-million-token rates accept six decimal places, with checked integer
arithmetic and decimal-string amounts over HTTP. Admins choose estimated cost
or deliberate internal weights. While the basis is estimated cost, the model-rate form can fill in one click from Models.dev or OpenRouter, converting base USD
text-token prices with Frankfurter's latest USD/CNY reference rate; there is no
multiplier, since a rate is a team's own budget share rather than a resale
price. Suggestions round up to two significant digits (at
least one reference point per million tokens for positive costs). Missing rates
remain unchanged; a failed or stale FX lookup disables price application rather
than guessing a rate. Conditional and non-text charges are not represented.
The administrator reviews the values (or undoes the fill) and saves through the existing rate API;
lookups never persist data or create an upstream association.

Prices have immutable revisions tied to effective model/provider identity.
Capture the price before dispatch; changing rates never reprices old calls.
Referenced presets use the effective model's price. Cache subcounts are already
inside input, and reasoning is already inside output. Sum disjoint buckets
once. Unknown rates produce unpriced points, never a zero-price assumption.
Explicit zero rates are supported. No prompt or response text is stored.

## Admission and calendar windows

A request resolves current membership and its actual model before entering a
short SQL transaction. A team guard row serializes policy selection across
instances. Reserve all applicable team, per-person and provider point/token
caps together, commit, then dispatch. Each cap requires
`spent + reserved + request_bound <= limit`; conditional counter updates and
append-only events protect/reconstruct the projections (ADR 0023).

Policies support day/month in an explicit IANA timezone, point caps, input,
output and total-token caps. Every enabled applicable cap must pass, including
for admins. The default-member policy creates a separate window per member;
a member override replaces that period's default. An override can be limited,
unlimited, or restored to inheritance. Disabling enforcement retains tracking.
Changing a cap or replacing a default/override never resets consumption.
New policies start counting at activation, without retroactive charges.

A timezone edit takes effect at the old boundary. DST produces real 23/25-hour
days; new windows cannot overlap the preceding one. Reservations always settle
into their original window, including after a reset. Clock regression fails
closed. Weekly/lifetime windows, request-rate and concurrent-call caps are not
implemented in this slice.

## Supported hard-limit routes

The initial bound adapter supports direct `https://api.deepseek.com` (optionally
`/v1`) text/local-function calls to `deepseek-flash`, `deepseek-v4-pro` and
known Flash aliases. Use the documented full 1M-token context as the conservative
input bound; forward an explicit `max_tokens` output bound, translating the
client alias when necessary. The adapter defaults output to 8,192 and rejects
more than 393,216 output tokens. Custom proxy URLs, images/files, server tools
and unknown billable fields cannot inherit this contract. See the upstream
[completion contract](https://api-docs.deepseek.com/api/create-chat-completion/)
and [model limits](https://api-docs.deepseek.com/quick_start/pricing/).

Full-context preauthorization can reject a short prompt if the remaining budget
cannot cover a maximum call. This trades availability for a conservative cap;
it does not claim a character heuristic is an accurate tokenizer. Actual
measured consumption releases the unused hold. Other BYOK providers still have
JSON/SSE reporting with enforcement disabled; enabling a hard cap rejects an
unverified route before it reaches the provider. Token-only budgets can operate
without a reference rate on supported routes.

Protocol replay tests exercise this adapter. No live-provider certification or
paid production rollout is implied by those tests. Supplier contract changes
require a new review before continuing to claim a hard bound.

## Settlement and recovery

The gateway forwards provider bytes while a bounded observer extracts usage.
Trust final JSON or complete SSE ending with `[DONE]` and transport EOF. Settle
once in a short transaction and release unused reservations. Duplicate final
reports cannot spend twice. Invalid, incomplete, cancelled, missing or
unpriceable-overflow results remain pending with their holds retained.

Each call has a persisted 15-minute deadline. A maintenance loop every 30 seconds
marks overdue running calls pending after a grace period. It never redispatches
an ambiguous request or releases a hold merely because the process disappeared.
A reliable late final report can settle a pending call.

Admins can explicitly reconcile pending/unpriced BYOK records with validated
tokens, optional points and a reason. Preserve the original record and actor
before marking the projection estimated. Late actual usage after manual
resolution is retained as separate evidence, without silently replacing the
estimate. An observed maximum overrun records actual consumption and suspends
further hard-budget calls for that provider/model until reviewed. This changes
reference budgets, not supplier invoices or hosted monetary balances.

## Edition meters

An edition may register its own kinds of usage, such as a cloud computer's
running time ([ADR 0036](../adr/0036-edition-meters.md)), through
`edition.Host.RegisterMeters` (`server/edition/meter.go`,
`server/internal/usage/meter.go`). A community instance registers none.

- **A meter** has a name, a unit, and labels for both in `en` and `zh-CN`.
  Names are unique on the instance, and an extension registers once.
- **`Reserve`** holds points for one member in every applicable team and
  member window, under the same budget gate and cap checks as a model call,
  and calls the edition's `ReserveMeter` in that transaction. It writes a
  usage row with `meter` set and no config, provider, model or tokens.
  Provider policies and token limits do not apply. A hold lasts at most 24
  hours.
- **`Settle`** records the measured `quantity` and the points the edition
  prices it at, calls `SettleMeter`, spends the points and releases the hold.
  Settling twice changes nothing; more points than were held settle and are
  flagged `usage_bound_exceeded`.
- **Recovery is the model call's:** an unsettled hold past its time is marked
  pending with its points still held, and only the owning edition settles
  it. An administrator's resolution refuses it (`usage_meter_owned`).
- **Usage and its export show the row** by the meter's labels and quantity
  (`meter` in `UsageEntry`; `meter`, `quantity` and `unit` columns in CSV).

## API and console

| Route under `/api/teams/{teamId}` | Responsibility |
| --- | --- |
| `GET/PUT /model-rates/{configId}` | Read/edit revisioned reference rates; admins write |
| `GET /usage` | Paginated user/config/time-filtered request history |
| `GET /usage/export` | Same authorization/filtering, formula-safe CSV, maximum 10,000 rows; excess fails without partial output |
| `POST /usage/{requestId}/resolve` | Admin's reasoned estimate or bound-violation review |
| `GET/PUT /budgets` | Applicable policies/current windows; admin revision-checked writes |
| `GET /budgets/notices` | Latest notification delivery states, own recipient records for members |
| `POST /budgets/notices/{noticeId}/retry` | Admin retries a failed notice after cooldown |
| `GET /summary` | The overview's counts: last 30 days' calls and points, unresolved calls, failed notices, windows past a notice threshold, the caller's quota summary and pending reviews |

Members see their own calls, per-person policies/windows and notification rows;
shared team/provider limits remain visible. Admins inspect the whole team.
The budget page shows per-member current-period activity, spent/reserved points
and remaining enabled points after reservations. Unknown usage leaves remaining
points unconfirmed; lowered caps clamp availability to zero without hiding
actual consumption. Other scope caps must still pass admission.
Budget reads also return an advisory `summary` for the authenticated member,
including admins. It takes the minimum applicable team/member point allowance
after holds and preserves unknown usage. Token-only caps are flagged separately;
provider caps stay on the detail page. `resetAt` is the earliest policy boundary,
not a guarantee that all exhausted limits reopen then. Reads create no windows.
Companion clients load this independently of configuration sync, clear it on
team/account/server changes and never use it as an admission authorization.
The team summary (`GET /summary`, `usage.Service.Summary`) is what the console's
overview opens with. It is scoped like the rest: an admin counts the team's
calls, unresolved calls (from any time), failed notices and every window past a
notice threshold; a member counts their own calls and sees the windows that
apply to them, with zero for what only an admin resolves. Its thresholds are the
notices' (80, 95 and 100 % of a point cap), so the overview and the mail agree.
Points sum what the period spent, edition meters included; calls, `unpriced`
and `unresolved` count model calls only, since a metered row is settled by its
edition (ADR 0036). `unpriced` says how many calls the points leave out.
Outsiders retain team-not-found behavior. Typed failures report exhaustion,
unconfirmed usage, missing prices, unsupported bounds and accounting failures;
limit errors include scope/reset time. CSV retains stable user/model ids and
leaves unknown amounts empty. All visible selectors use the custom component.

## Notifications

Insert 80/95/100-percent threshold notices in the accounting transaction. Each
policy selects admins, the affected member, both or none; team/provider scopes
notify admins only. Thresholds use actual spent amounts, not temporary holds.
Unpriced points cannot trigger a claimed points threshold; token thresholds
still work. Notification failure never changes a budget result.

Workers lease outbox rows, recheck current membership/role/preferences, skip
expired windows and suppress obsolete lower pending thresholds. Reuse SMTP,
localized plain text, originating instance links and stable Message-ID values.
Retry transient failures with bounded backoff/jitter; terminal failures are
visible for administrative retry. Delivery is at least once because an SMTP
acceptance can precede a worker crash. No arbitrary external recipient or
conversation content is included. No SMTP leaves the console usable and queues
unsent notices until a configured sender can handle them.

## Verification and next boundary

Tests cover three-dialect concurrent admission across database clients and the
actual authenticated gateway, exact releases, stale forms, override inheritance,
policy edits, midnight/DST, lost processes, explicit recovery, retained evidence,
notification leases/retries/audience changes, cross-team/member isolation and
CSV injection/oversize refusal. The repository gate checks types, lint, docs,
generation drift, tests and builds; isolated browser walkthroughs verify the
admin/member workflows. Live upstream calls are a separate launch gate.

A later closed wallet participant must reserve and settle in the same SQL
transaction and restrict hosted monetary adjustments independently. It must use
this normalizer/budget engine, without querying open tables from closed code.
Hosted model supply, real prepaid/promotional balances, CNY 10/5 trial grants,
payments, refunds/disputes and financial reconciliation remain separate work.
