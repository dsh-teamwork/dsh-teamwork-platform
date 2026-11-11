# Design

> **Status:** Current · **Updated:** 2026-11-10

The DSH Teamwork visual system — the whale mark, the indigo-and-paper palette, type, spacing and icons — and the file in code that owns each part.

The brand is one picture: a whale sounding, its fluke tilted into a calm sea,
in paper on an indigo plate. What surfaces is this one piece of work; what goes
under is what the team keeps: *work done with AI comes back to the team*.
Every surface is drawn from two colours, **indigo**
and **paper**, with indigo-tinted ink for text. **The stylesheets are the
source of truth and this file describes them**: where the two disagree, the
stylesheet is right and this file is stale.

## Where each part lives

| Part | Owner in code |
| --- | --- |
| Brand mark | `docs/brand/icon.svg` — the one hand-edited copy; every icon and logo is exported from it |
| Exports | `scripts/generate-icons.mjs` (`pnpm assets:icons`) |
| Web colour, radius, faces | `apps/web/src/app/globals.css` |
| Console colour, radius, faces | `premium/apps/manage/src/app/globals.css` |
| Hosted site colour, the ocean | `premium/apps/site/src/app/globals.css` |
| Share card | `premium/apps/site/src/app/opengraph-image.tsx` — the exported `public/logo.svg` beside the name (Onest Bold) and tagline (Onest Regular), on paper |

## The mark

`docs/brand/icon.svg` is a 400×400 artboard: an indigo plate
(`<rect id="plate" fill="#1E2F6D">`) and one paper-coloured path
(`<path id="mark" fill="#F8F5EF">`).

- **What is drawn.** A humpback fluke, scaled to fill most of the plate and
  tilted 15° about the point where it enters the water; a sea surface that is a
  low, even wave (amplitude ≈ 1.25 % of the side, stroke ≈ 7 %) running off both
  edges of the plate; and a narrow gap in the wave on each side of the stalk, so
  the stalk reads as passing through the surface. The fluke is centred on its
  own rotated bounds, and the picture — fluke tip to wave — on the plate.
- **One flat path, no effects.** The wave, the gaps and the clipping of the
  stalk at the surface are resolved into plain filled geometry: no strokes,
  masks, clip paths or opacity. Edit the geometry, not the effects.
- **The plate is part of the mark.** The sea is drawn edge to edge, so the mark
  is never shown without its plate and never recoloured. There is no
  monochrome or plate-less variant.
- **Small sizes.** It is the same picture at every size; at 16 px it still
  reads as a fluke over a line of sea.
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

Every colour is a variable, and `.dark` on `<html>` swaps the whole scale — on
the web and in the console through next-themes (`attribute="class"`). Light
grounds are a warm paper (hue 85) and text is an indigo-tinted ink (hue 268);
dark grounds are indigo-black and text is paper.

### Brand colours

| Name | Value | Hex (for raster and share cards) | Use |
| --- | --- | --- | --- |
| Indigo | `oklch(0.33 0.11 268)` | `#1E2F6D` | The plate; `--brand` in light |
| Paper | `oklch(0.97 0.008 85)` | `#F8F5EF` | The mark; `--brand-foreground` in light |

### Web and console

Both declare the same scale; the console adds three outcome colours.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--background` | `oklch(0.985 0.004 85)` | `oklch(0.17 0.03 268)` | Page ground |
| `--foreground` | `oklch(0.2 0.03 268)` | `oklch(0.96 0.006 85)` | Body text |
| `--card` | `oklch(1 0 0)` | `oklch(0.21 0.035 268)` | Raised surface |
| `--card-foreground` | `oklch(0.2 0.03 268)` | `oklch(0.96 0.006 85)` | Text on a card |
| `--muted` | `oklch(0.96 0.006 85)` | `oklch(0.26 0.035 268)` | Quiet fill |
| `--muted-foreground` | `oklch(0.47 0.025 268)` | `oklch(0.74 0.025 268)` | Secondary text |
| `--primary` | `oklch(0.23 0.035 268)` | `oklch(0.94 0.008 85)` | The one CTA per form; neutral ink |
| `--primary-foreground` | `oklch(0.985 0.004 85)` | `oklch(0.21 0.035 268)` | Text on primary |
| `--secondary` | `oklch(0.96 0.006 85)` | `oklch(0.26 0.035 268)` | Secondary button |
| `--secondary-foreground` | `oklch(0.23 0.035 268)` | `oklch(0.96 0.006 85)` | |
| `--accent` | `oklch(0.95 0.008 85)` | `oklch(0.26 0.035 268)` | Hover surface — never the brand |
| `--accent-foreground` | `oklch(0.23 0.035 268)` | `oklch(0.96 0.006 85)` | |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` | Deleting, failing |
| `--destructive-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` | |
| `--brand` | `oklch(0.33 0.11 268)` | `oklch(0.8 0.085 268)` | Brand chrome: indigo |
| `--brand-foreground` | `oklch(0.97 0.008 85)` | `oklch(0.19 0.035 268)` | Text on brand |
| `--border` | `oklch(0.91 0.008 85)` | `oklch(1 0 0 / 10%)` | Hairlines |
| `--input` | `oklch(0.91 0.008 85)` | `oklch(1 0 0 / 15%)` | Field border |
| `--ring` | `oklch(0.62 0.08 268)` | `oklch(0.55 0.08 268)` | Focus ring (`outline-ring/50` on everything) |

Console only:

| Token | Light | Dark |
| --- | --- | --- |
| `--success` | `oklch(0.52 0.13 150)` | `oklch(0.72 0.14 150)` |
| `--warning` | `oklch(0.62 0.14 70)` | `oklch(0.8 0.14 75)` |
| `--info` | `oklch(0.55 0.12 245)` | `oklch(0.72 0.12 245)` |

The hosted site only — its landing page's ocean
(`premium/apps/site/src/app/page.tsx`, `premium/apps/site/src/components/home/sea.tsx`).
The site declares the web scale plus these. The sea is the same in both themes,
so these are the one part of the scale that does not swap, except `--fluke`:

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--ocean` | `oklch(0.33 0.11 268)` | same | The sea at the surface; the top of the sections' gradient |
| `--ocean-deep` | `oklch(0.17 0.04 268)` | same | The bottom of the gradient; panels set in the sea |
| `--ocean-foreground` | `oklch(0.97 0.008 85)` | same | Text and foam on the sea |
| `--ocean-muted` | `oklch(0.8 0.035 268)` | same | Secondary text on the sea |
| `--ocean-line` | `oklch(1 0 0 / 13%)` | same | Hairlines on the sea |
| `--ocean-accent` | `oklch(0.83 0.14 86)` | same | Depth labels and step numbers only |
| `--fluke` | `oklch(0.33 0.11 268)` | `oklch(0.96 0.006 85)` | The hero fluke: indigo on a paper sky, paper on a night one |

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

## Component rules

- **Never a literal colour.** No Tailwind palette step (`text-gray-600`,
  `text-green-600`) in a page and no hex in a component; a colour is a token.
  The share card, which renders outside the stylesheet, is the one exception
  and uses the brand hexes above.
- **`--brand` is not `--accent`.** `accent` is the subtle hover surface every
  shadcn-shaped primitive uses, so a brand colour there tints every hover. Brand
  chrome opts in with `bg-brand` / `text-brand`.
- **`--primary` stays neutral** — indigo-tinted ink in light, paper in dark. It
  is the one call to action per form, not the brand.
- **The logo is an image, not a drawing.** Show `public/logo.svg` at its square
  size; never redraw the mark inline or recolour it. The one inline whale is the
  hosted landing page's hero illustration (`premium/apps/site`,
  `components/home/sea.tsx`): the mark's fluke
  path at hero scale over a full-width sea, drawn from the ocean tokens. It is
  not the logo, has no plate, and is not exported.
- **The hosted landing page is one dive.** A paper sky and the fluke sounding,
  then each section a little deeper in one `--ocean` → `--ocean-deep`
  gradient, labelled with its depth. It states only what ships; a planned
  capability is not on it.
- **The web app's `/` is a start page**: the logo, the name and tagline, and
  the one way in. Every instance has it, self-hosted ones included.
- **Outcomes in the console** use `--success` / `--warning` / `--info` /
  `--destructive`, and every mutation reports through a `sonner` toast.
- **Console chrome comes from `premium/apps/manage/src/components/console.tsx`**
  before a page writes its own.
- **Every surface works in both themes.** A token added to `:root` is added to
  `.dark` in the same change.
