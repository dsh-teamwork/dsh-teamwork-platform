# Design

> **Status:** Current · **Updated:** 2026-11-23

The DSH Teamwork visual system — the whale mark, the black-and-white palette with its two accents, type, spacing and icons — and the file in code that owns each part.

The brand is one picture: a whale sounding, its paper fluke rising from a sea
that settles in layers under an indigo sky. What surfaces is this one piece of
work; what goes under, layer on layer, is what the team keeps: *work done with
AI comes back to the team*. The landing page interprets the mark as a navy woodcut with white clouds above a blue sea.
The product interface uses neutral black and white, the same frame as DeepSeek
Harness itself, so the plugin sits inside DSH without a seam; two accents set
the team edition apart, **navy** for what belongs to the team and **amber** for
what needs attention. **The stylesheets are the
source of truth and this file describes them**: where the two disagree, the
stylesheet is right and this file is stale.

## Where each part lives

| Part | Owner in code |
| --- | --- |
| Brand mark | `docs/brand/icon.svg` — the one hand-edited copy; every icon and logo is exported from it |
| Exports | `scripts/generate-icons.mjs` (`pnpm assets:icons`) |
| Web colour, radius, faces | `apps/web/src/globals.css` |
| Console colour, radius, faces | `apps/manage/src/globals.css` |
| Share card | `apps/web/scripts/prerender.mjs` — the exported `public/logo.svg` beside the name (Onest Bold) and tagline (Onest Regular), in ink on white |

## The mark

`docs/brand/icon.svg` is a 400×400 artboard: an indigo plate
(`<rect id="plate" fill="#1E2F6D">`) for the sky, then four filled paths drawn
in this order — `mark` (the paper fluke), `sea`, `surface` and `swell`. Why it
is a layered sea and which versions were turned down is
[ADR 0035](adr/0035-the-fluke-rises-from-a-layered-sea.md).

- **What is drawn.** A humpback fluke the hero's shape (`sea.tsx`), tilted 15°
  about its stalk and filling most of the plate's width; below it a sea whose
  surface is a wave running off both edges (mean height 72.5 % of the side,
  amplitude 2 %, period a quarter of the side), with a crest under the stalk.
  The sea is the deep tone and covers the stalk, so the fluke enters the water
  instead of ending at a line. A light band traces the surface, and two thinner
  swell bands, each lower and calmer than the last, lie in the deep water.
- **Every part is its own colour.** Fluke, surface, deep sea, swell and sky
  never share a fill, so the fluke never merges into the water and the sea
  never merges into the sky.
- **Flat paths, no effects.** Waves and bands are filled outlines and the
  stalk is hidden by painting order: no strokes, masks, clip paths or
  opacity. Edit the geometry, not the effects.
- **The plate is part of the mark.** The sea is drawn edge to edge, so the mark
  is never shown without its plate and never recoloured. There is no
  monochrome or plate-less variant.
- **Small sizes.** It is the same picture at every size; at 16 px the swell
  bands blur into the deep sea and it still reads as a fluke rising from water.
- **What it must not become.** A fluke above short, centred, shrinking lines
  reads as a goblet or a trophy; the sea always spans the full plate. The
  fluke is seen from behind, never a whale in profile, which keeps it apart
  from DeepSeek's mark.

### Exports

`pnpm assets:icons` writes every copy, and `--check` in the gate fails when one
drifts. No exported file is edited by hand.

| Export | What it is |
| --- | --- |
| Each app's `src/app/icon.png` and `apple-icon.png` (`apps/*`, `premium/apps/*`) | The artboard, square and full-bleed: the platform rounds it |
| Each app's `public/logo.svg` | The artboard as a vector with the plate's corners rounded (22 % of the side) and the mark clipped to them; one file for light and dark themes |

The plate keeps `id="plate"` and a six-digit `fill`: the script reads the plate
colour from it and rounds that element for the logos.

## Colour

Every colour is a variable, and `.dark` on `<html>` swaps the whole scale. There
are two themes, light and dark. Until a person chooses, they get their system's
setting and follow it; a choice is kept in the browser under one key (`theme`)
by `apps/web/src/lib/theme.ts` and the instance console's own
`apps/manage/src/lib/theme.ts`, so it holds on every page of a site. An inline
script sets it before the first paint. Grounds
and text are a neutral grey (hue 286, chroma under 0.02): white grounds and
near-black text in light, near-black grounds and white text in dark. Colour
appears in four places only: the mark, the preset avatars (each in its own
plate and accent), the two accents, and the outcome colours.

### Brand colours

| Name | Value | Hex (for raster and share cards) | Use |
| --- | --- | --- | --- |
| Navy | `oklch(0.33 0.11 268)` | `#1E2F6D` | The plate; `--brand` in light: what belongs to the team |
| Amber | `oklch(0.765 0.14 73)` | `#E8A33D` | `--signal` in light: what needs attention |
| Ink | `oklch(0.145 0.002 286)` | `#0A0A0B` | `--foreground` and `--primary` in light |
| Paper | `oklch(0.97 0.008 85)` | `#F8F5EF` | The mark's fluke only |
| Surface | `oklch(0.67 0.103 270)` | `#7B91D4` | The mark's sea surface only |
| Swell | `oklch(0.39 0.121 268)` | `#2B3F86` | The mark's swell bands only |
| Deep | `oklch(0.24 0.077 270)` | `#111A42` | The mark's deep sea only |

### Web and console

Both declare the same scale; the console adds three outcome colours.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--background` | `oklch(1 0 0)` | `oklch(0.15 0.002 286)` | Page ground |
| `--foreground` | `oklch(0.145 0.002 286)` | `oklch(0.967 0.001 286)` | Body text |
| `--card` | `oklch(1 0 0)` | `oklch(0.192 0.004 286)` | Raised surface |
| `--card-foreground` | `oklch(0.145 0.002 286)` | `oklch(0.967 0.001 286)` | Text on a card |
| `--muted` | `oklch(0.976 0.001 286)` | `oklch(0.232 0.006 286)` | Quiet ground: the sidebar, a code block |
| `--muted-foreground` | `oklch(0.478 0.016 286)` | `oklch(0.712 0.013 286)` | Secondary text |
| `--primary` | `oklch(0.145 0.002 286)` | `oklch(0.967 0.001 286)` | The one CTA per form: black in light, white in dark |
| `--primary-foreground` | `oklch(1 0 0)` | `oklch(0.15 0.002 286)` | Text on primary |
| `--secondary` | `oklch(0.953 0.003 286)` | `oklch(0.274 0.006 286)` | Secondary button, a selected tab or nav item |
| `--secondary-foreground` | `oklch(0.145 0.002 286)` | `oklch(0.967 0.001 286)` | |
| `--accent` | `oklch(0.953 0.003 286)` | `oklch(0.274 0.006 286)` | Hover surface — never the brand |
| `--accent-foreground` | `oklch(0.145 0.002 286)` | `oklch(0.967 0.001 286)` | |
| `--destructive` | `oklch(0.529 0.193 29)` | `oklch(0.711 0.166 22)` | Deleting, failing |
| `--destructive-foreground` | `oklch(1 0 0)` | `oklch(0.15 0.002 286)` | |
| `--brand` | `oklch(0.33 0.11 268)` | `oklch(0.452 0.124 270)` | Navy: team identity (below); in dark a lighter navy, still a fill under white text |
| `--brand-foreground` | `oklch(1 0 0)` | `oklch(1 0 0)` | Text on brand |
| `--signal` | `oklch(0.765 0.14 73)` | `oklch(0.807 0.137 78)` | Amber: attention, as a dot or a line, never text |
| `--success` | `oklch(0.527 0.137 150)` | `oklch(0.84 0.149 155)` | Green: a computer is online, as a dot and the word beside it |
| `--mark-plate` | `oklch(0.953 0.003 286)` | `oklch(0.92 0.003 286)` | The tile under a provider's mark: light in both themes |
| `--border` | `oklch(0.932 0.003 286)` | `oklch(0.287 0.007 286)` | Hairlines |
| `--input` | `oklch(0.887 0.007 286)` | `oklch(0.351 0.01 286)` | Field and outline-button border |
| `--ring` | `oklch(0.452 0.124 270)` | `oklch(0.766 0.095 271)` | Focus ring (`outline-ring/50` on everything): navy |

The operator console (`apps/manage`) also has these, `--success` with the
same values as above:

| Token | Light | Dark |
| --- | --- | --- |
| `--warning` | `oklch(0.554 0.121 66)` | `oklch(0.807 0.137 78)` |
| `--info` | `oklch(0.55 0.12 245)` | `oklch(0.72 0.12 245)` |

`--warning` is amber dark enough to be read as text; `--signal` is the same hue
bright enough to be seen as a dot.

`--info` sits near the brand's hue; it marks a state, and brand chrome never
borrows it. Each token is exposed to Tailwind as `--color-*` in the file's
`@theme inline` block, so a page writes `bg-brand`, `text-muted-foreground`,
`text-success`.

## Type

| Surface | Faces | Scale |
| --- | --- | --- |
| Web, console | `--font-sans`: `system-ui, -apple-system, 'Segoe UI', sans-serif`; `--font-mono`: `ui-monospace, 'SF Mono', monospace` | Tailwind's defaults. The console adds `tabular` (tabular numerals) for columns of numbers |
| Share card | Onest 700 and 400 (`apps/web/assets/fonts`: latin `.woff`, OFL licence beside them) | The name at 84px bold, the tagline at 36px regular; no CJK glyphs, so the card is English |

## Spacing and radius

- **Spacing** is a 4px unit: Tailwind's default.
- **Radius** is one variable and four steps: `sm` = `--radius` − 4px, `md` =
  − 2px, `lg` = `--radius`, `xl` = + 4px; `--radius` is `0.5rem`. The logo's
  own corner (22 % of its side) is the mark's, not this scale's.

## Icons

Lucide (`lucide-react`) on web and console, sized and coloured through
`className` from tokens (e.g. `text-muted-foreground`). There is no product
icon set.

**Model providers are shown by their makers' marks, in their own colours.**
`PROVIDER_MARKS` in `packages/shared/src/providers.ts` holds them, copied from
LobeHub's icons (the colour version where one exists; OpenAI, Anthropic, xAI,
Ollama and OpenRouter are black, as their makers draw them on light), and
`providerMark` picks one from what names a model (its id and name first, then
its provider's name and address), so a model resold by OpenRouter shows its
maker. Every place that names a model or a provider draws one on a
`--mark-plate` tile (20px beside a line of text or in a menu, 36px heading a
card), drawn by `apps/web/src/components/provider-mark.tsx` and the phone
app's own. The plate stays light in dark mode, since a maker's colours are
chosen for light. A mark's colours are the one exception to "never a literal
colour": they are the maker's artwork, kept as data, never a token and never
used for anything else. An unknown provider shows two initials on a
`--secondary` tile. A mark never stands without the name beside it.

### Preset avatars

A preset's face is one of a fixed library of avatars,
`packages/shared/src/avatars.ts`, which the web console, the phone app and the
DSH plugin's panel all draw (`apps/web/src/components/preset-avatar.tsx`, the
app's own, and the plugin's from a byte-for-byte copy that
`server/e2e/avatars_test.go` holds equal), so a preset looks the same
everywhere. **An avatar is an abstract emblem of a
role**: two or three flat shapes — circles, arcs, rounded bars — composed to
suggest what the role does (a balance for legal, a stack of coins for finance,
work laid out in time for project management), in **Paper** and one accent on
a plate with the logo's corner (22 %). It is neither a stock app glyph (a
magnifier, a gear), which makes a preset read as a menu item, nor a drawing of
a person or a character, which at this size reads as clip art.

- **Each role has its own plate and one accent.** Plates are deep, muted
  tones (dark enough that the paper figure always reads) and accents the
  lighter colour of its attribute; no two neighbouring roles share a hue
  family. The team assistant keeps the brand's navy and amber.
- **Flat fills, rarely a stroke**, three tones per avatar (paper, plate as a
  cut-out, accent), on a 32-unit square; shapes stay clear of the plate's
  rounded corners, so no client clips. Each must read at 20 px, so a detail
  smaller than about 1.5 units is left out.
- These hexes, in that file, are an exception to "never a literal colour":
  like the share card, the avatar is drawn outside the stylesheet and the same
  in both themes, as the logo is.

## Component rules

- **Never a literal colour.** No Tailwind palette step (`text-gray-600`,
  `text-green-600`) in a page and no hex in a component; a colour is a token.
  Three exceptions: the share card and the preset avatars, which render
  outside the stylesheet and use the hexes their sources name, and Google's
  four-colour G on the sign-in button, whose colours Google's branding fixes.
- **`--brand` is not `--accent`.** `accent` is the subtle hover surface every
  shadcn-shaped primitive uses, so a brand colour there tints every hover. Brand
  chrome opts in with `bg-brand` / `text-brand`.
- **`--primary` stays neutral** — black in light, white in dark. It is the one
  call to action per form, not the brand.
- **Navy says "this is the team's".** `--brand` marks the team edition, an
  admin, the team switcher, the selected item in a navigation (a 3px bar
  beside its grey fill) and links. It never fills a button.
- **Amber says "look here", and rarely.** `--signal` marks something waiting on
  the reader — a review, an approval, a budget near its limit — as a 6px dot
  or a line at most 3px thick, at most twice on one screen. It never colours
  text or fills a surface; a word that needs the same meaning uses
  `--warning`.
- **What a click acts on shows the hand.** Buttons, menu items, options,
  disclosure summaries and the labels of checkboxes and file inputs get
  `cursor: pointer` from the base layer in `apps/web/src/globals.css` and
  `apps/manage/src/globals.css`, as links do; a disabled control keeps the
  arrow. A component adds no `cursor-pointer` of its own.
- **A sidebar scrolls quietly.** A scroll area inside a sidebar or its drawer
  takes `scrollbar-quiet` (`apps/web/src/globals.css`): no track and no arrows,
  only a 4px rounded thumb in `--muted-foreground` at 25%, darker while the area
  is hovered or the thumb dragged, so the bar reads as part of the surface in
  both themes rather than the operating system's grey.
- **Lists are rows, not cards.** Rows are divided by `--border` hairlines; a
  card's border and fill are kept for the one block that has to stand apart.
- **The logo keeps its plate.** Use `public/logo.svg` at its square size. The
  landing illustration in `apps/web/src/public/sea.tsx` uses woodcut whales
  with hatching on their bodies and engraved lines in the water.
- **The landing page follows the dive.** A full-width woodcut forms the
  horizon beneath the opening copy, at the same height in both languages.
  The surface pod takes its indigo from the logo plate.
  White paper behind the text opens into a pale sky with two low cloud banks.
  The engraving uses several sea-blue ink values, with near-white upper chapters
  and a navy seabed. Dark mode carries the same shapes into a dusk sky.
  Two overlapping swells travel along
  the engraved water, bending the waterline and its ink strokes every frame. Three humpbacks breach in a staggered,
  seven-second cycle. The small distant whale leads, the large foreground whale
  follows, and the third whale trails behind. Each flexes its tail stock and
  folds its pectoral fin on entry. On phones the pod spreads across the water
  below the copy. A large, low-contrast humpback passes behind the middle chapters. A slow bend travels down the lone
  whale’s back and grows into a broader tail stroke. A viewport of open water separates the lone whale from both
  the surface and the closing pod, even during fast scrolls and anchor jumps.
  At Assets the text turns light. The closing pod uses three solid silhouettes,
  from muted slate blue at the top to ink blue nearest the seabed. Two shallow, low-contrast sediment layers
  sit beneath the pod. A compact footer continues the lower sediment
  color, with the whale mark and name on the left and navigation on the right. The return link pairs an underline and an upward arrow with the opening dive link’s downward arrow. The composition also fits narrow
  screens, and reduced motion keeps the artwork still.
- **The landing page's first screen is what the product is and how to start.**
  The title, one sentence, the plugin to copy and the install guide sit
  above the waterline. The header carries *Create a team* and a GitHub icon
  beside the theme switch that links to the Teamwork plugin. The dive link at
  the lower right scrolls to the team overview at −5 m. The overview asks
  how the whole team can make the most of DSH and introduces access,
  collaboration, governance, and team assets in page order.
  *Collaborate* shows a market research preset moving from submission to
  review, publication, and team sync. *Team assets* shows how teams can keep
  workflows from marketing, operations, and research. Its sample history lists
  each resource's type, version, approval, reviewer, and time, newest first.
  In the first chapter, the team diagram reads
  left to right (`apps/web/src/public/topology.tsx`): the team's people,
  each with an icon for where they work (DSH Desktop, a terminal, the phone,
  the admin's web console), curved arrows into DSH Teamwork in the middle, and
  on the right the mainstream upstream providers, each by its own logo
  (`PROVIDER_MARKS`, the same marks the console draws, each on its plate),
  as well as a custom provider. Cloud DSH sits below them as a separate
  workspace in limited trial on the hosted edition. The phone's icon carries `public/logo.svg` on its
  screen, since the app is ours. The hub lists the page's sections, each with
  one line of what it gives a team, said as value rather than as a feature. The lines carry no words: an amber pulse plays the story
  on a loop (the admin publishes, every member's card ticks, a call goes out
  to a model), and hovering a feature dims what it does not involve (and
  lights each device's icon for *Everywhere*), keeping the plain pointer; motion
  stops under reduced motion. It is drawn from tokens, so it follows the
  theme, and its words are the page's language.
- **Real screens live in the sections below, never in the first screen.**
  *Everywhere* presents desktop and terminal, browser, and phone as equal
  columns that stack on narrow screens. Each pairs a short scenario with a
  screenshot. The open page describes joining a shared DSH by invitation from
  a browser or phone. An edition can provide copy for its own workspace.
  *Collaborate* shows the market research preset's proposed changes in the
  review screen and describes how members work on a shared DSH, each in
  their own session. The hosted page shows the community workspace alongside
  its own cloud workspace. *Govern* pairs the usage page with three
  questions managers ask about budgets, security, and access. Each screen sits in a plain window or phone frame
  drawn from tokens. They are captures of the real interfaces with a demo team,
  in `apps/web/public/home/`, one per language, captured again when those
  screens change, never drawn.
- **Pricing compares deployment choices by capability.** The comparison table
  scrolls horizontally on narrow screens and ends with a payment-model row.
  Community self-hosting has no license fee. Hosted models on Teamwork Cloud
  are prepaid by usage. Enterprise solutions are listed for inquiries about
  requirements and availability.
- **The web app's `/` is the landing page on every instance**, self-hosted
  ones included (ADR 0007), so every claim holds for any instance. A
  capability only the hosted service offers, or one that is planned, appears
  only with its status beside it (*Hosted service*, *Coming*), never as
  something the reader already has.
- **The documentation at `/docs` reads like the console.** A sidebar of
  grouped pages with the selected one marked as in the console, the page in
  `.prose-document` (the legal pages' type), and "On this page" on wide
  screens; a code block carries its own copy button
  (`apps/web/src/public/docs.tsx`).
- **The console's sidebar is work first** (ADR 0043, 0049): *Workspace* at
  the top, the reader's own (home, team resources with their submissions inside,
  my usage, an edition's work pages); for the admin, *Team management* at the foot, opening on the
  team overview, then *Team assets* (models, presets, plugins, Team DSH,
  review, versions) and *Members and spend* (members, usage, budgets).
  Team management is a `--brand` sheet laid over the workspace, with
  rounded top corners and a shadow cast upward; the rows inside it are
  drawn in the navy's foreground, the selected bar included. It starts
  folded, its pages slide open above its toggle and fold away again (none
  of it moves under reduced motion), and folded on one of its pages the
  toggle carries the selected bar. Alt+M (Option+M on a Mac), shown on the
  toggle while it is hovered, opens and folds it, and choosing a Workspace
  page folds it away. The account is one menu at its foot; below `md` the sidebar is a sheet
  behind a menu button (`apps/web/src/components/team/console-shell.tsx`).
- **A code is typed into slots, the same on the web and the phone.** A
  computer's PIN and a pairing code open with an icon on a `--secondary`
  tile, a title and one line of what to type. A PIN is four rings that fill
  with a dot; a pairing code is one box per character, split in two halves
  with a dash as the computer shows it. The next slot is outlined in
  `--foreground`, and the last character sends the code
  (`apps/web/src/components/ui/code-entry.tsx`; the app's `pin-gate.tsx` and
  `pair.tsx`).
- **Choosing from a list is one component.** `apps/web/src/components/ui/select.tsx`:
  an outline trigger and a menu on the card surface, never a native `<select>`.
  The language picker is one too; the public pages, which run no React, draw
  the same look in `apps/web/src/public/controls.tsx`. The operator
  console has its copy in `apps/manage/src/components/ui/select.tsx`, which an
  edition's pages import from `@dsh-teamwork/manage`.
- **The theme is one icon button** showing the theme in force (sun or moon)
  and switching to the other: in the home header, in the top bar and footer of
  the docs and `/teams`, and beside the account at the foot of a team's sidebar
  (`apps/web/src/components/theme-toggle.tsx`).
- **A person is their avatar, and it leads to their account.** A top bar shows
  the initial in a circle; a team's sidebar ends, as Router9 Studio's rail does,
  in a row of the avatar, the person's name and their role in the team, with
  the theme button beside it. Either goes straight to the account settings
  (`/account`, `apps/web/src/pages/account.tsx`): the name, edited in
  place, and the email, then preferences (language, theme), the password,
  your teams and signing out, in sections divided by hairlines. The email is
  printed there and nowhere else in the chrome (`apps/web/src/components/account.tsx`). The operator
  console's rail ends the same way: the operator's initial (the address only
  on hover), the theme and signing out (`apps/manage/src/components/layout/sidebar.tsx`).
- **Sign-in is split in two** (`apps/web/src/pages/sign-in.tsx`). From
  `lg` up, the left side is the navy plate: the logo, the home page's title in
  its serif and lede, and three flat bands of the plate's foreground for the
  sea. The right side is the form on the page ground, with the way home at
  its top left and, at its top right, the language and the theme drawn as
  the home page's header draws them (`HeaderLocaleMenu`). The form lists every OAuth door the
  session's `doors` reports as an outline button with its provider's
  mark (Google's in its own four colours), then a divider and the one email door (a code, or a
  password with a show toggle); a sent code turns the screen into *Check your
  email* with a wide six-digit field, another email and a new code. Below
  `lg` the plate is dropped and the logo sits above the title.
- **`/teams` is the console's front page**: the site's top bar (`components/site-frame.tsx`, shared with `/account`), the teams as
  cards (each with the team's initials on navy, and a member's home, resources
  and submissions, or an admin's overview, models and members, a click away) grouped by role, a welcome with the first steps when
  there are none, and creating or joining a team in a dialog.
- **Outcomes in the console** use `--success` / `--warning` / `--info` /
  `--destructive`, and every mutation reports through a `sonner` toast.
- **Console chrome comes from `premium/apps/manage/src/components/console.tsx`**
  before a page writes its own.
- **Every surface works in both themes.** A token added to `:root` is added to
  `.dark` in the same change.
