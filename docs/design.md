# Design

> **Status:** Current · **Updated:** 2026-11-17

The DSH Teamwork visual system — the whale mark, the black-and-white palette with its two accents, type, spacing and icons — and the file in code that owns each part.

The brand is one picture: a whale sounding, its paper fluke rising from a sea
that settles in layers under an indigo sky. What surfaces is this one piece of
work; what goes under, layer on layer, is what the team keeps: *work done with
AI comes back to the team*. The mark is the only picture in colour. Every
surface around it is neutral black and white, the same frame as DeepSeek
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
| Web colour, radius, faces | `apps/console/src/globals.css` |
| Console colour, radius, faces | `apps/manage/src/globals.css` |
| Share card | `apps/console/scripts/prerender.mjs` — the exported `public/logo.svg` beside the name (Onest Bold) and tagline (Onest Regular), in ink on white |

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
by `apps/console/src/lib/theme.ts` and the instance console's own
`apps/manage/src/lib/theme.ts`, so it holds on every page of a site. An inline
script sets it before the first paint. Grounds
and text are a neutral grey (hue 286, chroma under 0.02): white grounds and
near-black text in light, near-black grounds and white text in dark. Colour
appears in three places only: the mark, the two accents, and the outcome
colours.

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
| `--border` | `oklch(0.932 0.003 286)` | `oklch(0.287 0.007 286)` | Hairlines |
| `--input` | `oklch(0.887 0.007 286)` | `oklch(0.351 0.01 286)` | Field and outline-button border |
| `--ring` | `oklch(0.452 0.124 270)` | `oklch(0.766 0.095 271)` | Focus ring (`outline-ring/50` on everything): navy |

Console only:

| Token | Light | Dark |
| --- | --- | --- |
| `--success` | `oklch(0.527 0.137 150)` | `oklch(0.84 0.149 155)` |
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
| Share card | Onest 700 and 400 (`apps/console/assets/fonts`: latin `.woff`, OFL licence beside them) | The name at 84px bold, the tagline at 36px regular; no CJK glyphs, so the card is English |

## Spacing and radius

- **Spacing** is a 4px unit: Tailwind's default.
- **Radius** is one variable and four steps: `sm` = `--radius` − 4px, `md` =
  − 2px, `lg` = `--radius`, `xl` = + 4px; `--radius` is `0.5rem`. The logo's
  own corner (22 % of its side) is the mark's, not this scale's.

## Icons

Lucide (`lucide-react`) on web and console, sized and coloured through
`className` from tokens (e.g. `text-muted-foreground`). There is no product
icon set.

## Component rules

- **Never a literal colour.** No Tailwind palette step (`text-gray-600`,
  `text-green-600`) in a page and no hex in a component; a colour is a token.
  The share card, which renders outside the stylesheet, is the one exception
  and uses the brand hexes above.
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
- **Lists are rows, not cards.** Rows are divided by `--border` hairlines; a
  card's border and fill are kept for the one block that has to stand apart.
- **The logo is an image, not a drawing.** Show `public/logo.svg` at its square
  size; never redraw the mark inline or recolour it. The one inline whale is the
  landing page's hero illustration (`apps/console/src/public/sea.tsx`): the
  mark's fluke path at hero scale, in `--foreground` at 7 % opacity, behind one
  `--foreground` wave line that runs the full width; below the line the page's
  own ground covers the stalk. It is not the logo, has no plate, and is not
  exported.
- **The landing page is black on white, and it goes down.** The faint fluke
  and its wave line, then sections divided by hairlines, each labelled with its
  depth in mono, and the closing call on one `--brand` band, the page's only
  large area of colour. The depths tell the brand's story in order: the
  surface is one person's work and the places it happens (every platform),
  then what the team shares (collaboration) and controls (governance), and
  the deep floor is what the team keeps as its assets.
- **The web app's `/` is the landing page on every instance**, self-hosted
  ones included (ADR 0007), so every claim holds for any instance. A
  capability only the hosted service offers, or one that is planned, appears
  only with its status beside it (*Hosted service*, *Coming*), never as
  something the reader already has.
- **The documentation at `/docs` reads like the console.** A sidebar of
  grouped pages with the selected one marked as in the console, the page in
  `.prose-document` (the legal pages' type), and "On this page" on wide
  screens; a code block carries its own copy button
  (`apps/console/src/public/docs.tsx`).
- **The console's sidebar is grouped by what a team does**: the overview, then
  *Team assets* (models, presets, plugins), *Collaboration* (review, versions)
  and *Governance* (members, usage, budgets, and an edition's own team pages).
  The account is one menu at its foot; below `md` the sidebar is a sheet
  behind a menu button (`apps/console/src/components/team/console-shell.tsx`).
- **Choosing from a list is one component.** `apps/console/src/components/ui/select.tsx`:
  an outline trigger and a menu on the card surface, never a native `<select>`.
  The language picker is one too; the public pages, which run no React, draw
  the same look in `apps/console/src/public/controls.tsx`.
- **The theme is one icon button** showing the theme in force (sun or moon)
  and switching to the other: in the top bar and the footer of the public
  pages and of `/teams`, and beside the account at the foot of a team's sidebar
  (`apps/console/src/components/theme-toggle.tsx`).
- **A person is their avatar.** The account menu opens from the initial in a
  circle; the email is the menu's first line, never printed in a top bar or a
  sidebar.
- **`/teams` is the console's front page**: the site's top bar, the teams as
  cards (each with the team's initials on navy, and its overview, models and
  members a click away) grouped by role, a welcome with the first steps when
  there are none, and creating or joining a team in a dialog.
- **Outcomes in the console** use `--success` / `--warning` / `--info` /
  `--destructive`, and every mutation reports through a `sonner` toast.
- **Console chrome comes from `premium/apps/manage/src/components/console.tsx`**
  before a page writes its own.
- **Every surface works in both themes.** A token added to `:root` is added to
  `.dark` in the same change.
